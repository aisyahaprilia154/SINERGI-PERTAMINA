export function DataTable({ columns, rows, rowKey = 'id', loading = false, error = '', onRetry, emptyMessage = 'Tidak ada data.', loadingMessage = 'Memuat data…', ariaLabel = 'Data', className = 'operational-table-wrap' }) {
  return <>
    {error && <p className="operational-status" role="alert">{error}{onRetry && <button type="button" className="au-button" disabled={loading} onClick={onRetry}>Coba lagi</button>}</p>}
    <div className={className}>
      <table aria-label={ariaLabel} aria-busy={loading}>
        <thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.header}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(row => <tr key={typeof rowKey === 'function' ? rowKey(row) : row[rowKey]}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)
          : <tr><td className="au-empty" colSpan={columns.length}>{loading ? loadingMessage : emptyMessage}</td></tr>}</tbody>
      </table>
    </div>
  </>
}
