import{o as e}from"./parser-DqrQhi-o.js";import{r as t}from"./rank-2nVtF72k.js";var n=`demo.aiostreams`,r=`demo#mkv`,i={id:475557,daysAgo:40},a=[`https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`,`https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8`];function o(){let e=`/samples/flow-sample.mkv`;return typeof location>`u`?e:new URL(e,location.href).toString()}var s=e=>String(e).padStart(2,`0`);async function c(c,l,u){if(await new Promise((e,t)=>{let n=setTimeout(e,450);u?.addEventListener(`abort`,()=>(clearTimeout(n),t(u.reason)),{once:!0})}),c.type===`movie`&&c.tmdbId===i.id)return[];let d=c.type===`show`?`.S${s(c.season??1)}E${s(c.episode??1)}`:``,f=`${c.item.title.replace(/[:'’]/g,``).replace(/\s+/g,`.`)}${d}`,p=[[`🧿 1080p 🎫
WEB-DL
🔊 AAC
📦 3.98 GB
🌎 English`,`${f}.1080p.WEB-DL.AAC.H264.mkv`,0],[`✨ 4K 🎫
WEB-DL
DV HDR10
🔊 DD+ Atmos 5.1
📦 18.2 GB
🌎 English`,`${f}.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC.mkv`,0],[`🧿 1080p 🎫
BluRay
🔊 DTS-HD MA 7.1
📦 12.4 GB
🌎 English • Spanish`,`${f}.1080p.BluRay.DTS-HD.MA.7.1.x264.mkv`,1],[`🧿 720p
WEBRip
🔊 AAC 2.0
📦 1.18 GB
🌎 English • Hindi • Tamil`,`${f}.720p.WEBRip.AAC.2.0.x264.mkv`,1]].map(([r,i,o],s)=>{let c=e(r,i);c.isCached=!0;let u=t({id:`demo#${s}`,origin:`demo`,provider:`AIOStreams`,providerId:n,title:i,url:a[o],container:`m3u8`,filename:i,detail:`AIOStreams\n${r}`,traits:c,bingeGroup:`demo-${s}`},l);return u.unsupported&&s!==2&&delete u.unsupported,u}),m=`🧿 720p
MKV · remuxed in the browser
🔊 DTS • AAC • AC-3
🌎 English • Spanish`;return p.push(t({id:r,origin:`demo`,provider:`AIOStreams`,providerId:n,title:`Flow.Sample.720p.DTS.AAC.AC3.mkv`,url:o(),container:`mkv`,filename:`Flow.Sample.720p.DTS.AAC.AC3.mkv`,detail:`AIOStreams\n${m}`,traits:e(m,`Flow.Sample.720p.mkv`)},l)),p}export{c as n,i as r,n as t};
//# sourceMappingURL=demo-BLNq0rF0.js.map