# Legacy UI regression fixtures

Frozen reference implementations from stage 15, outside the production source tree. These modules exist only to keep the original Node regression tests and visual baselines executable. Production src and its build must never import this directory. Relative imports point to the retained shared engines/services. No entrypoint or production route selects these renderers.
