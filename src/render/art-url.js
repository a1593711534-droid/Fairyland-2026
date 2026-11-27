import { version } from '../../package.json'

const root = new URL('art/', new URL(import.meta.env.BASE_URL, document.baseURI))

export function artURL(path) {
  const url = new URL(path, root)
  url.searchParams.set('v', version)
  return url.href
}
