import path from 'node:path'
import {
  hydrateIdentityRegistrySourceAliases,
} from '../domain/canonical-asset-identity.js'
import { buildCanonicalParserResult } from '../domain/parser-contract.js'
import { compareCanonicalDatasetVersions } from '../domain/dataset-version-diff.js'
import { buildReadinessContract } from '../domain/publication-contract.js'
import { AppError, asAppError } from '../errors.js'
import { generateRelationArtifacts } from '../topology/semantic-relation-engine.js'
import { applyArtifacts } from '../topology/topology-service.js'
import { DatasetVersionValidationService } from './dataset-validation-service.js'
import { extractKmzArchive, orderKmlCandidates } from './kmz-extractor.js'
import { parseKmlFile } from './kml-parser.js'
import { mergeKmlParserOutputs } from './kml-parser-output-merger.js'
import { projectCanonicalImport } from './legacy-import-projection.js'

export class ImportPipeline {
  constructor({
    repository,
    fileStore,
    auditLog,
    limits,
    metadataAliases = {},
    sourceIdentityFallback = 'none',
    folderMappings = [],
    relationMappings = [],
    topology = {},
    publicationPolicyVersion = null,
    validationService = new DatasetVersionValidationService(),
    clock = () => new Date(),
  }) {
    this.repository = repository
    this.fileStore = fileStore
    this.auditLog = auditLog
    this.limits = limits
    this.metadataAliases = metadataAliases
    this.sourceIdentityFallback = sourceIdentityFallback
    this.folderMappings = folderMappings
    this.relationMappings = relationMappings
    this.topology = topology
    this.publicationPolicyVersion = publicationPolicyVersion
    this.validationService = validationService
    this.clock = clock
  }

  async process({
    datasetVersionId,
    sourcePath,
    extension,
    actorId,
    correlationId = null,
    jobId = null,
    progressReporter = null,
  }) {
    let workspace = null
    let resources = []
    let selectedKmlPath = null
    let packageInfo = null

    await this.auditLog.record('dataset_import.processing_started', {
      actorId,
      datasetVersionId,
      correlationId,
      outcome: 'processing',
      details: {
        jobId,
        graphRevision: null,
      },
    })

    try {
      await this.#progress(datasetVersionId, 20, 'reading_source', progressReporter)
      let parserOutput

      if (extension === '.kmz') {
        workspace = await this.fileStore.createWorkspace()
        await this.#progress(datasetVersionId, 30, 'extracting_kmz', progressReporter)
        const extracted = await extractKmzArchive(sourcePath, workspace, this.limits)
        resources = extracted.resources
        packageInfo = {
          packageType: 'kmz',
          kmlEntries: extracted.kmlFiles.map(({ relativePath, size }) => ({
            relativePath,
            size,
          })),
          ignoredEntries: extracted.ignoredEntries,
          entryCount: extracted.entryCount,
          totalUncompressedSize: extracted.totalExtractedSize,
        }
        const selection = await selectKmlCandidate(extracted.kmlFiles, {
          ...this.limits,
          folderMappings: this.folderMappings,
        })
        selectedKmlPath = selection.selected.relativePath
        parserOutput = selection.parserOutput
        packageInfo.mergedKmlPaths = selection.mergedKmlPaths
        parserOutput.issues = [
          ...parserOutput.issues,
          ...selection.issues,
          ...extracted.ignoredEntries.map((entry) => ({
            severity: 'warning',
            issueCode: 'ignored_kmz_resource',
            message: `File ${entry} tidak dieksekusi atau diekstrak karena bukan resource yang diperbolehkan.`,
            canActivate: true,
          })),
        ]
      } else {
        selectedKmlPath = path.basename(sourcePath)
        packageInfo = {
          packageType: 'kml',
          kmlEntries: [{ relativePath: selectedKmlPath }],
          ignoredEntries: [],
          entryCount: 1,
        }
        await this.#progress(datasetVersionId, 50, 'parsing_kml', progressReporter)
        parserOutput = await parseKmlFile(sourcePath, {
          ...this.limits,
          folderMappings: this.folderMappings,
        })
      }

      await this.#progress(datasetVersionId, 70, 'validating_import', progressReporter)
      const current = await this.repository.get(datasetVersionId)
      const activeRecord = await this.repository.findActive(
        current.datasetVersion.datasetId,
        {
          excludeId: datasetVersionId,
          branchId: current.datasetVersion.branchId,
        },
      )
      const sourceSelection = {
        selectedKmlPath,
        resources,
        ...packageInfo,
      }
      const canonicalParser = buildCanonicalParserResult({
        parserOutput,
        datasetVersion: current.datasetVersion,
        sourceSelection,
        metadataAliases: this.metadataAliases,
        resources,
        identityRegistry: hydrateIdentityRegistrySourceAliases({
          datasetVersion: current.datasetVersion,
          sourceFeatures: activeRecord?.sourceFeatures ?? [],
          classifiedObjects: activeRecord?.classifiedObjects ?? [],
          identityRegistry: activeRecord?.assetIdentityRegistry
            ?? activeRecord?.identityRegistry
            ?? [],
        }).identityRegistry,
        autoAssignOnboarding: true,
        ...(this.publicationPolicyVersion
          ? { publicationPolicyVersion: this.publicationPolicyVersion }
          : {}),
      })
      const adaptedResult = projectCanonicalImport({
        parserOutput,
        canonicalParser,
        datasetVersion: current.datasetVersion,
        sourceIdentityFallback: this.sourceIdentityFallback,
      })
      const topologyArtifacts = generateRelationArtifacts(
        canonicalParser.topologyInputBundle,
        {
          config: this.topology,
          generatedAt: this.clock().toISOString(),
        },
      )
      const projectedResult = applyArtifacts(adaptedResult, topologyArtifacts, {
        topologyRun: {
          runId: `initial:${datasetVersionId}`,
          actorId,
          generatedAt: topologyArtifacts.generatedAt,
          reason: 'initial_import',
          topologyRuleSetVersion: topologyArtifacts.topologyRuleSetVersion,
          summary: topologyArtifacts.summary,
        },
      })
      const result = this.validationService.validate({
        result: projectedResult,
        parserOutput,
        sourceSelection,
        expectedBranchId: current.datasetVersion.branchId,
      })
      const readiness = buildReadinessContract({
        datasetVersion: result.datasetVersion,
        issues: result.issues,
        parserCoverage: canonicalParser.coverage,
        sourceFeatures: canonicalParser.sourceFeatures,
        sourceGeometries: canonicalParser.sourceGeometries,
        sourceOverlays: canonicalParser.sourceOverlays,
        classifiedObjects: canonicalParser.classifiedObjects,
        topologyReadiness: result.topologyGraph?.edges?.length
          ? result.topologyReadiness ?? null
          : null,
        topologyGraph: result.topologyGraph?.edges?.length
          ? result.topologyGraph
          : null,
        evaluatedAt: this.clock().toISOString(),
      })
      canonicalParser.readiness = readiness
      const comparison = compareCanonicalDatasetVersions(result, activeRecord)

      await this.#progress(datasetVersionId, 90, 'persisting_result', progressReporter)
      const completedAt = this.clock().toISOString()
      const record = {
        ...result,
        sourceSelection,
        canonicalParser,
        sourceFeatures: canonicalParser.sourceFeatures,
        sourceGeometries: canonicalParser.sourceGeometries,
        sourceMetadataEntries: canonicalParser.sourceMetadataEntries,
        sourceOverlays: canonicalParser.sourceOverlays,
        sourceResources: canonicalParser.sourceResources,
        classifiedObjects: canonicalParser.classifiedObjects,
        assetIdentityMap: canonicalParser.assetIdentityMap,
        assetIdentityRegistry: canonicalParser.identityRegistry ?? [],
        identityRegistry: canonicalParser.identityRegistry ?? [],
        topologyInputBundle: canonicalParser.topologyInputBundle,
        parserCoverage: canonicalParser.coverage,
        readiness,
        datasetVersionDiffs: comparison.items.map((item) => ({
          ...item,
          baseDatasetVersionId: comparison.baseDatasetVersionId,
          candidateDatasetVersionId: comparison.candidateDatasetVersionId,
          comparisonRevision: comparison.comparisonRevision,
        })),
        comparisonRevision: comparison.comparisonRevision,
        comparisonSummary: comparison.summary,
        parserVersions: {
          sourceChecksum: canonicalParser.sourceChecksum,
          parserVersion: canonicalParser.parserVersion,
          normalizerVersion: canonicalParser.normalizerVersion,
          classificationRuleSetVersion: canonicalParser.classificationRuleSetVersion,
          metadataAliasVersion: canonicalParser.metadataAliasVersion,
          folderMappingVersion: canonicalParser.folderMappingVersion,
          styleMappingVersion: canonicalParser.styleMappingVersion,
          controlledVocabularyVersion: canonicalParser.controlledVocabularyVersion,
          publicationPolicyVersion: canonicalParser.publicationPolicyVersion,
        },
        processing: {
          ...current.processing,
          progress: 100,
          stage: result.datasetVersion.status,
          completedAt,
        },
      }
      await this.repository.update(datasetVersionId, () => record)
      await this.auditLog.record('dataset_import.processing_completed', {
        actorId,
        datasetVersionId,
        branchId: result.datasetVersion.branchId,
        correlationId,
        outcome: result.datasetVersion.status,
        details: {
          jobId,
          graphRevision: result.topologyGraph?.graphRevision ?? null,
          validationStatus: result.datasetVersion.validationStatus,
          sourceFilename: result.datasetVersion.sourceFilename,
          summary: result.datasetVersion.summary,
        },
      })
      await this.#progress(datasetVersionId, 100, result.datasetVersion.status, progressReporter)
      return record
    } catch (error) {
      const appError = asAppError(error)
      const failed = await this.#markInvalid(datasetVersionId, appError)
      await this.auditLog.record('dataset_import.processing_failed', {
        actorId,
        datasetVersionId,
        branchId: failed.datasetVersion.branchId,
        correlationId,
        outcome: 'invalid',
        details: {
          jobId,
          graphRevision: failed.topologyGraph?.graphRevision ?? null,
          errorCode: appError.code,
          message: appError.expose ? appError.message : 'Internal processing error',
        },
      })
      return failed
    } finally {
      await this.fileStore.removeWorkspace(workspace)
    }
  }

  async #progress(datasetVersionId, progress, stage, progressReporter = null) {
    await this.repository.update(datasetVersionId, (record) => ({
      ...record,
      processing: {
        ...record.processing,
        progress,
        stage,
        updatedAt: this.clock().toISOString(),
      },
    }))
    await Promise.resolve(progressReporter?.(progress, stage)).catch(() => {})
  }

  async #markInvalid(datasetVersionId, error) {
    return this.repository.update(datasetVersionId, (record) => {
      const failed = this.validationService.createFailure({ record, error })
      const summary = {
        ...emptySummary(),
        ...(failed.datasetVersion.summary ?? {}),
      }
      return {
        ...failed,
        datasetVersion: {
          ...failed.datasetVersion,
          summary,
        },
        layers: failed.layers ?? [],
        assets: failed.assets ?? [],
        geometries: failed.geometries ?? [],
        relations: failed.relations ?? [],
        processing: {
          ...record.processing,
          progress: 100,
          stage: 'invalid',
          completedAt: this.clock().toISOString(),
        },
      }
    })
  }
}

async function selectKmlCandidate(kmlFiles, limits) {
  const ordered = orderKmlCandidates(kmlFiles)
  const issues = []
  let selected = null
  const validCandidates = []

  for (const candidate of ordered) {
    try {
      const parsed = await parseKmlFile(candidate.absolutePath, limits)
      validCandidates.push({ candidate, parserOutput: parsed })
      if (!selected) {
        selected = candidate
      }
    } catch (error) {
      if (error.code === 'unsafe_xml_declaration') throw error
      issues.push({
        severity: 'warning',
        issueCode: 'invalid_kml_candidate',
        message: `Kandidat KML ${candidate.relativePath} tidak valid dan tidak dipilih.`,
        canActivate: true,
      })
    }
  }

  if (!selected) {
    throw new AppError('Tidak ada kandidat KML valid di dalam KMZ.', {
      code: 'kmz_without_valid_kml',
      statusCode: 422,
    })
  }
  const mergedKmlPaths = validCandidates.map(({ candidate }) => candidate.relativePath)
  const parserOutput = mergeKmlParserOutputs(validCandidates.map(({ candidate, parserOutput: parsed }) => ({
    relativePath: candidate.relativePath,
    parserOutput: parsed,
  })))
  if (validCandidates.length > 1) {
    issues.push({
      severity: 'information',
      issueCode: 'multiple_kml_documents_merged',
      message: `${validCandidates.length} dokumen KML digabung deterministik: ${mergedKmlPaths.join(', ')}.`,
      canActivate: true,
    })
  }
  return { selected, parserOutput, issues, mergedKmlPaths }
}

export function summarizeImportJobResult(record) {
  return {
    datasetVersionId: record?.datasetVersion?.id ?? null,
    status: record?.datasetVersion?.status ?? null,
    validationStatus: record?.datasetVersion?.validationStatus ?? null,
    publicationStatus: record?.datasetVersion?.publicationStatus ?? null,
    summary: structuredClone(record?.datasetVersion?.summary ?? null),
    graphRevision: record?.topologyGraph?.graphRevision ?? null,
    recordRevision: Number.isInteger(record?.recordRevision) ? record.recordRevision : 0,
  }
}

export function createProcessingRecord(datasetVersion, clock = () => new Date()) {
  return {
    contractVersion: '1.0.0',
    datasetVersion: {
      ...datasetVersion,
      validationStatus: 'pending',
      publicationStatus: 'unpublished',
      publicationProfile: null,
      status: 'processing',
      summary: emptySummary(),
    },
    layers: [],
    assets: [],
    geometries: [],
    relations: [],
    issues: [],
    validation: {
      schemaVersion: '1.0.0',
      status: 'pending',
      canActivate: false,
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        information: 0,
        blocking: 0,
      },
      facets: {
        severity: {},
        scope: {},
        issueCode: {},
      },
      integrity: {
        datasetVersionId: datasetVersion.id,
        branchId: datasetVersion.branchId,
        activeVersionUnchanged: true,
        userVisible: false,
        publicationStatus: 'unpublished',
      },
    },
    processing: {
      progress: 10,
      stage: 'queued',
      queuedAt: clock().toISOString(),
    },
  }
}

function emptySummary() {
  return {
    totalFolders: 0,
    totalPlacemarks: 0,
    totalAssets: 0,
    totalPoints: 0,
    totalLines: 0,
    totalPolygons: 0,
    totalRelations: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
    removedAssets: 0,
    errors: 0,
    warnings: 0,
  }
}
