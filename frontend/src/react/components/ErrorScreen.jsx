export function ErrorScreen() {
  return (
    <section role="alert">
      <h1>Halaman tidak dapat dimuat</h1>
      <p>Coba muat ulang halaman untuk melanjutkan.</p>
      <a href={window.location.href}>Muat ulang</a>
    </section>
  )
}
