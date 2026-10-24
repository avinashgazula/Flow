import type Hls from 'hls.js'
import { proxied } from './proxy'

/* HLS through the stream proxy. Every request (the manifest, each variant, each segment and key) is made
   through the proxy, but the player is told it was made to the provider's own address: hls.js resolves a
   manifest's relative paths against the address the manifest came from, and against the proxy's address those
   paths would point at the proxy and not at the provider. */

type LoaderClass = typeof Hls.DefaultConfig.loader

export function proxyLoader(Base: LoaderClass, template?: string): LoaderClass {
  return class ProxyLoader extends Base {
    override load(context: Parameters<InstanceType<LoaderClass>['load']>[0], config: Parameters<InstanceType<LoaderClass>['load']>[1], callbacks: Parameters<InstanceType<LoaderClass>['load']>[2]): void {
      const original = context.url
      context.url = proxied(original, template)
      const restore = () => {
        context.url = original
      }
      super.load(context, config, {
        onSuccess: (response, stats, ctx, details) => {
          restore()
          callbacks.onSuccess({ ...response, url: original }, stats, ctx, details)
        },
        onError: (error, ctx, details, stats) => {
          restore()
          callbacks.onError(error, ctx, details, stats)
        },
        onTimeout: (stats, ctx, details) => {
          restore()
          callbacks.onTimeout(stats, ctx, details)
        },
        onAbort: callbacks.onAbort && ((stats, ctx, details) => (restore(), callbacks.onAbort?.(stats, ctx, details))),
        onProgress: callbacks.onProgress,
      })
    }
  }
}
