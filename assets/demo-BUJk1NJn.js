import{A as e,r as t}from"./rank-ByXJZVsC.js";var n=`demo.aiostreams`,r=`demo#mkv`,i=[`https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`,`https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8`];function a(){let e=`/samples/flow-sample.mkv`;return typeof location>`u`?e:new URL(e,location.href).toString()}var o=e=>String(e).padStart(2,`0`);async function s(s,c,l){await new Promise((e,t)=>{let n=setTimeout(e,450);l?.addEventListener(`abort`,()=>(clearTimeout(n),t(l.reason)),{once:!0})});let u=s.type===`show`?`.S${o(s.season??1)}E${o(s.episode??1)}`:``,d=`${s.item.title.replace(/[:'’]/g,``).replace(/\s+/g,`.`)}${u}`,f=[[`🧿 1080p 🎫
WEB-DL
🔊 AAC
📦 3.98 GB
🌎 English`,`${d}.1080p.WEB-DL.AAC.H264.mkv`,0],[`✨ 4K 🎫
WEB-DL
DV HDR10
🔊 DD+ Atmos 5.1
📦 18.2 GB
🌎 English`,`${d}.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC.mkv`,0],[`🧿 1080p 🎫
BluRay
🔊 DTS-HD MA 7.1
📦 12.4 GB
🌎 English • Spanish`,`${d}.1080p.BluRay.DTS-HD.MA.7.1.x264.mkv`,1],[`🧿 720p
WEBRip
🔊 AAC 2.0
📦 1.18 GB
🌎 English • Hindi • Tamil`,`${d}.720p.WEBRip.AAC.2.0.x264.mkv`,1]].map(([r,a,o],s)=>{let l=e(r,a);l.isCached=!0;let u=t({id:`demo#${s}`,origin:`demo`,provider:`AIOStreams`,providerId:n,title:a,url:i[o],container:`m3u8`,filename:a,detail:`AIOStreams\n${r}`,traits:l,bingeGroup:`demo-${s}`},c);return u.unsupported&&s!==2&&delete u.unsupported,u}),p=`🧿 720p
MKV · remuxed in the browser
🔊 DTS • AAC • AC-3
🌎 English • Spanish`;return f.push(t({id:r,origin:`demo`,provider:`AIOStreams`,providerId:n,title:`Flow.Sample.720p.DTS.AAC.AC3.mkv`,url:a(),container:`mkv`,filename:`Flow.Sample.720p.DTS.AAC.AC3.mkv`,detail:`AIOStreams\n${p}`,traits:e(p,`Flow.Sample.720p.mkv`)},c)),f}export{s as n,n as t};
//# sourceMappingURL=demo-BUJk1NJn.js.map