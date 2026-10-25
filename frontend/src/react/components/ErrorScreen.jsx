export function ErrorScreen() {
  return (
    <section role="alert">
      <h1>Halaman tidak dapat dimuat</h1>
      <p>Coba muat ulang halaman untuk melanjutkan.</p>
      <a data-document-navigation href={window.location.href}>Muat ulang</a>
    </section>
  )
}
