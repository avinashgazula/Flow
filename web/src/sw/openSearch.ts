/* The OpenSearch descriptor that lets a browser's address bar search Flow (type "Flow", press Tab or Space,
   then the words). Written at build time, because the spec wants absolute addresses and only the build
   knows where the site is served from. */

const escapeXML = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `site` is the site's address with its base path ("https://flow.example/Flow/"). Without it (a local build)
 *  the addresses are relative, which most browsers ignore but a person can still read. */
export function openSearchDescriptor(site: string | undefined): string {
  const at = (path: string) => escapeXML(site ? new URL(path, site).href : path)
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Flow</ShortName>
  <Description>Search movies, shows and people in Flow.</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="192" height="192" type="image/png">${at('icon-192.png')}</Image>
  <Url type="text/html" method="get" template="${at('search')}?q={searchTerms}"/>
</OpenSearchDescription>
`
}

/** Where the site will be served, from what the build is told: an explicit origin, the Pages custom domain
 *  or the repository's github.io address. Nothing for a local build. */
export function siteAddress(base: string, env: Record<string, string | undefined>): string | undefined {
  if (env.FLOW_SITE_URL) return new URL(base, env.FLOW_SITE_URL).href
  if (env.PAGES_DOMAIN) return `https://${env.PAGES_DOMAIN}${base}`
  const owner = env.GITHUB_REPOSITORY?.split('/')[0]
  if (owner) return `https://${owner.toLowerCase()}.github.io${base}`
  return undefined
}
