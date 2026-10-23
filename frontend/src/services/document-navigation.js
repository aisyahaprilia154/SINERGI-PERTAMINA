// Keep document navigation until the final migration stage; easy to stub in tests.
export const documentNavigation = {
  assign: url => window.location.assign(url),
  replace: url => window.location.replace(url),
  reload: () => window.location.reload(),
}
