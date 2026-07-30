import{a as A}from"./chunk-HEYE3OPC.js";import{b as R}from"./chunk-ADXSBXS2.js";import"./chunk-V6RIH2SY.js";import"./chunk-SPNHI25B.js";import"./chunk-6HITDN3U.js";import{b as j}from"./chunk-JNKSAC5K.js";import"./chunk-S2LCZOOX.js";import"./chunk-KL2A677A.js";import{g as B}from"./chunk-VACG6J3W.js";import"./chunk-LV4SKRBG.js";import"./chunk-JGFPSQ2M.js";import"./chunk-G2PF6QMD.js";import{$a as x,Aa as N,Cb as C,Da as s,Eb as a,Fb as P,Gb as k,Hb as D,Qa as V,S as w,X as y,Y as b,ab as v,bb as g,eb as $,ec as h,fb as L,gb as M,hb as o,ia as f,ib as r,ob as I,sb as u,ub as c}from"./chunk-EJISPTN3.js";import{a as _,b as O}from"./chunk-7CGTOI24.js";var m="https://mawkingbird.com",U={x:280,bluesky:300};function z(i="mastodon.social"){let e=i.replace(/^https?:\/\//,"").replace(/\/+$/,"")||"mastodon.social";return`${m}/anonymous?${encodeURIComponent(e)}`}function X(i,e){let t={profileUrl:e.profileUrl,handle:e.handle,visitUrl:e.visitUrl,mawkingbird:m};return i.split(`
`).filter(n=>(n.match(/\{(\w+)\}/g)??[]).every(d=>!!t[d.slice(1,-1)])).map(n=>n.replace(/\{(\w+)\}/g,(l,d)=>t[d]??"")).join(`
`).replace(/\n{3,}/g,`

`).trim()}function Y(i,e){let t=new URL(i==="x"?"https://x.com/intent/post":"https://bsky.app/intent/compose");return t.searchParams.set("text",e),t.toString()}var W=[{id:"x-straightforward",network:"x",title:"Straightforward",template:`I\u2019m on Mastodon! Come join me for social media built around communities instead of one central platform.

Find me here: {profileUrl}

Try it with ${m}

#Mastodon #Fediverse`},{id:"x-try-first",network:"x",title:"Try before committing",template:`Curious about Mastodon but haven\u2019t tried it yet? Mawkingbird makes it easy to explore and use Mastodon from the web.

${m}

#Mastodon #Fediverse #SocialMedia`},{id:"x-follow-me",network:"x",title:"Follow me",template:`I\u2019d love to see more of my X friends on Mastodon. It takes a couple of minutes to try.

Follow me at {profileUrl}

Start here: ${m}

#Mastodon #JoinMastodon`},{id:"x-no-algorithm",network:"x",title:"No algorithm",template:`Want a social feed you control instead of one chosen entirely by an algorithm? Give Mastodon a try.

Start with ${m}

#Mastodon #Fediverse #OpenSocial`},{id:"x-community",network:"x",title:"Lots of small communities",template:`Mastodon is made of independent communities that can still talk to one another. It\u2019s a different and surprisingly human way to use social media.

Come try it: ${m}

#Mastodon #Fediverse`},{id:"x-friendly-migration",network:"x",title:"Friendly migration",template:`You don\u2019t have to quit X to try Mastodon. Make an account, follow a few people, and see whether you like it.

${m}

#TryMastodon #Fediverse`},{id:"x-open-web",network:"x",title:"The open web",template:`I\u2019m spending more time on the open social web. Mastodon lets people pick their own community and still follow people everywhere else.

Join me: {profileUrl}

Or just start here: ${m}

#Mastodon #OpenWeb`},{id:"x-low-pressure",network:"x",title:"Low pressure",template:`Friendly invitation: come say hello to me on Mastodon sometime.

My profile: {profileUrl}

You can try Mastodon through ${m}

#Mastodon #Fediverse`},{id:"x-mawkingbird",network:"x",title:"About Mawkingbird",template:`Want to see what Mastodon is like? Try Mawkingbird, a web client for exploring and using the Fediverse.

${m}

#Mawkingbird #Mastodon #Fediverse`},{id:"x-bring-friends",network:"x",title:"Bring your friends",template:`Social networks get better when your friends are there. I\u2019m inviting mine to join me on Mastodon.

Find me at {handle}
Get started at ${m}

#JoinMastodon #Fediverse`}],G=[{id:"bsky-both-at-once",network:"bluesky",title:"Both at once",template:`Hey \u2014 some of your friends are over on Mastodon. You can hang out with both crowds in one timeline with Mawkingbird, and you don\u2019t even have to sign up for an account.

{visitUrl}

#Mastodon #Fediverse`},{id:"bsky-no-signup",network:"bluesky",title:"No signup needed",template:`You can read Mastodon right now without making an account anywhere. Open this, look around, and leave if it\u2019s not for you:

{visitUrl}

#Fediverse #Mastodon`},{id:"bsky-one-timeline",network:"bluesky",title:"One timeline",template:`I got tired of checking two apps, so now I read Bluesky and Mastodon in the same timeline. Mawkingbird does both, and Mastodon works without an account:

{visitUrl}

#Bluesky #Mastodon`},{id:"bsky-your-people",network:"bluesky",title:"Your people are there",template:`A surprising number of the people you used to follow are posting on Mastodon these days. No account needed to go see:

{visitUrl}

You\u2019ll find me at {handle}

#Mastodon #Fediverse`},{id:"bsky-window-shop",network:"bluesky",title:"Just window shopping",template:`Not asking you to switch to anything. Mawkingbird will show you Mastodon with no account, no email, no signup \u2014 just have a look and see whether your people are there.

{visitUrl}

#Fediverse #Mastodon`},{id:"bsky-say-hello",network:"bluesky",title:"Come say hello",template:`Come say hello to me on the Mastodon side sometime \u2014 {profileUrl}

You can read it without signing up for anything: {visitUrl}

#Mastodon #Fediverse`},{id:"bsky-same-web",network:"bluesky",title:"Same open web",template:`Bluesky and Mastodon are both the open social web, and there\u2019s no reason to pick just one. Mawkingbird reads both, and the Mastodon half needs no account at all:

{visitUrl}

#Bluesky #Mastodon #OpenWeb`},{id:"bsky-guest-pass",network:"bluesky",title:"Guest pass",template:`Consider this a guest pass to Mastodon: no account, no signup, just a public timeline you can read today. If you like it, then make an account.

{visitUrl}

#Mastodon #TryMastodon`}],J=[...W,...G];function S(i){return J.filter(e=>e.network===i)}var K=(i,e)=>e.variation.id;function q(i,e){i&1&&(o(0,"p",6),a(1," These ask people to join Mastodon and come find you. Your X followers probably don\u2019t have a fediverse account yet, so each one links somewhere they can start. "),r())}function Q(i,e){if(i&1&&(o(0,"p",6),a(1," Bluesky people don\u2019t need convincing about the open social web \u2014 they\u2019re just missing the friends who went to Mastodon. These lead with the fact that anyone can read Mastodon through Mawkingbird with no account at all, on "),o(2,"code"),a(3),r(),a(4,". "),r()),i&2){let t=c();s(3),P(t.homeHost()||"mastodon.social")}}function Z(i,e){if(i&1&&(o(0,"span",6),a(1),r()),i&2){let t=c();s(),k("\u2014 ",t.profileUrl())}}function ee(i,e){i&1&&(o(0,"span",6),a(1," \u2014 unavailable: the Anonymous account is browser-local, so there\u2019s no profile page to link to. "),o(2,"a",16),a(3,"Sign in"),r(),a(4," to include one. "),r())}function te(i,e){i&1&&a(0," \u26A0 ")}function ne(i,e){if(i&1&&(o(0,"p",21),a(1),r()),i&2){let t=c().$implicit;s(),k(" Longer than ",t.variation.network==="x"?"X":"Bluesky"," normally allows. Both networks count links their own way, so this is an estimate \u2014 but consider dropping a sentence. Keep the profile link if you can; it\u2019s the part that helps people find you. ")}}function ie(i,e){if(i&1){let t=I();o(0,"button",28),u("click",function(){y(t);let l=c().$implicit,d=c();return b(d.reset(l.variation.id))}),a(1," Reset to the original wording "),r()}}function oe(i,e){i&1&&(o(0,"span",26),a(1,"\u2713 Invitation copied"),r())}function ae(i,e){i&1&&(o(0,"span",27),a(1,"Couldn\u2019t use the clipboard"),r())}function re(i,e){if(i&1){let t=I();o(0,"li",11)(1,"div",17)(2,"h2"),a(3),r(),o(4,"span",18),v(5,te,1,0),a(6),r()(),o(7,"label",19),a(8),r(),o(9,"textarea",20),u("input",function(l){let d=y(t).$implicit,p=c();return b(p.onEdit(d.variation.id,l.target.value))}),r(),v(10,ne,2,1,"p",21),o(11,"div",22)(12,"a",23),u("click",function(){let l=y(t).$implicit,d=c();return b(d.onIntentOpen(l))}),a(13),r(),o(14,"button",24),u("click",function(){let l=y(t).$implicit,d=c();return b(d.copy(l))}),a(15,"Copy text"),r(),v(16,ie,2,0,"button",25),v(17,oe,2,0,"span",26),v(18,ae,2,0,"span",27),r()()}if(i&2){let t=e.$implicit,n=c();s(3),P(t.variation.title),s(),C("over",t.overLimit),x("aria-label",t.length+" of about "+n.limits[t.variation.network]+" characters"+(t.overLimit?" \u2014 too long":"")),s(),g(t.overLimit?5:-1),s(),D(" ",t.length,"/",n.limits[t.variation.network]," "),s(),x("for","invite-text-"+t.variation.id),s(),k(" ",t.variation.title," \u2014 invitation text, editable "),s(),M("id","invite-text-"+t.variation.id)("value",t.text),s(),g(t.overLimit?10:-1),s(2),M("href",t.intentUrl,N),x("aria-label",n.postLabel(t)),s(),k(" ",t.variation.network==="x"?"Post on X":"Post on Bluesky"," \u2197 "),s(3),g(t.edited?16:-1),s(),g(n.copied()===t.variation.id?17:-1),s(),g(n.copyFailed()===t.variation.id?18:-1)}}function le(i,e){if(i&1){let t=I();o(0,"div",29),u("click",function(){y(t);let l=c();return b(l.closeFallback())})("keyup.escape",function(){y(t);let l=c();return b(l.closeFallback())}),o(1,"div",30),u("click",function(l){return l.stopPropagation()})("keyup",function(l){return l.stopPropagation()}),o(2,"h2",31),a(3,"Copy this by hand"),r(),o(4,"p",6),a(5," This browser wouldn\u2019t give Mawkingbird clipboard access. Select the text below and copy it yourself. "),r(),o(6,"textarea",32),a(7),r(),o(8,"button",33),u("click",function(){y(t);let l=c();return b(l.closeFallback())}),a(9,"Done"),r()()()}i&2&&(s(7),P(e))}var H=class i{auth=w(R);server=w(j);diagnostics=w(A);network=f("x");limits=U;includeProfile=f(!0);edits=f({});order=f({x:S("x").map(e=>e.id),bluesky:S("bluesky").map(e=>e.id)});copied=f(null);copyFailed=f(null);fallbackText=f(null);profileUrl=h(()=>this.auth.account()?.url??"");handle=h(()=>{let e=this.auth.account();if(!e?.username||!this.profileUrl())return"";let t=e.acct??"";if(t.includes("@"))return`@${t}`;let n=this.homeHost();return n?`@${e.username}@${n}`:""});homeHost=h(()=>{let e=this.auth.account()?.acct??"",t=e.indexOf("@");return t>0?e.slice(t+1):this.server.baseUrl().replace(/^https?:\/\//,"")});visitUrl=h(()=>z(this.homeHost()));hasProfile=h(()=>!!this.profileUrl());naming=h(()=>this.includeProfile()&&this.hasProfile());context=h(()=>({profileUrl:this.naming()?this.profileUrl():"",handle:this.naming()?this.handle():"",visitUrl:this.visitUrl()}));cards=h(()=>{let e=this.network(),t=this.context(),n=this.edits(),l=new Map(S(e).map(p=>[p.id,p]));return this.order()[e].map(p=>l.get(p)).filter(p=>!!p).map(p=>{let F=n[p.id],T=F??X(p.template,t),E=Array.from(T).length;return{variation:p,text:T,length:E,overLimit:E>U[e],edited:F!==void 0,intentUrl:Y(e,T)}})});ngOnInit(){this.diagnostics.info("Invites","page:open",{anonymous:this.auth.isAnonymous,hasProfile:this.hasProfile()})}setNetwork(e){this.network.set(e),this.clearCopyState()}toggleProfile(e){this.includeProfile.set(e),this.clearCopyState()}onEdit(e,t){this.edits.update(n=>O(_({},n),{[e]:t})),this.clearCopyState()}reset(e){this.edits.update(t=>{let n=_({},t);return delete n[e],n}),this.clearCopyState()}shuffle(){this.order.update(e=>{let t=e[this.network()];return t.length<2?e:O(_({},e),{[this.network()]:[...t.slice(1),t[0]]})})}onIntentOpen(e){this.diagnostics.info("Invites","user:intent-open",{network:e.variation.network,variationId:e.variation.id,includedMastodonProfile:this.mentionsProfile(e.text),edited:e.edited,overLimit:e.overLimit})}async copy(e){this.diagnostics.info("Invites","user:copy",{network:e.variation.network,variationId:e.variation.id});try{await navigator.clipboard.writeText(e.text),this.copyFailed.set(null),this.copied.set(e.variation.id)}catch{this.copied.set(null),this.copyFailed.set(e.variation.id),this.fallbackText.set(e.text)}}closeFallback(){this.fallbackText.set(null)}clearCopyState(){this.copied.set(null),this.copyFailed.set(null)}mentionsProfile(e){let t=this.profileUrl(),n=this.handle();return!!t&&e.includes(t)||!!n&&e.includes(n)}postLabel(e){return`Post \u201C${e.variation.title}\u201D on ${e.variation.network==="x"?"X":"Bluesky"}`}static \u0275fac=function(t){return new(t||i)};static \u0275cmp=V({type:i,selectors:[["app-invites"]],decls:34,vars:12,consts:[[1,"page-title"],[1,"muted","page-intro"],["role","tablist","aria-label","Where to invite from",1,"tabs"],["type","button","role","tab","id","invite-tab-x",1,"tab",3,"click"],["type","button","role","tab","id","invite-tab-bluesky",1,"tab",3,"click"],["role","tabpanel",1,"invite-intro"],[1,"muted","small"],[1,"profile-toggle"],["type","checkbox",3,"change","checked","disabled"],["type","button",1,"btn","btn-outline","btn-sm",3,"click"],[1,"invite-list"],[1,"invite-card"],["role","presentation","tabindex","-1",1,"overlay"],[1,"muted","small","footnote"],["routerLink","/settings/invites"],["routerLink","/settings/import-export"],["routerLink","/login"],[1,"invite-head"],[1,"count"],[1,"sr-only"],["rows","9",1,"invite-text",3,"input","id","value"],[1,"warn","small"],[1,"invite-actions"],["target","_blank","rel","noopener noreferrer",1,"btn",3,"click","href"],["type","button",1,"btn","btn-outline",3,"click"],["type","button",1,"link"],["role","status",1,"copy-note"],["role","status",1,"copy-note","warn"],["type","button",1,"link",3,"click"],["role","presentation","tabindex","-1",1,"overlay",3,"click","keyup.escape"],["role","dialog","aria-modal","true","aria-labelledby","invite-copy-fallback-title",1,"dialog",3,"click","keyup"],["id","invite-copy-fallback-title"],["rows","9","readonly","",1,"invite-text"],["type","button",1,"btn",3,"click"]],template:function(t,n){if(t&1&&(o(0,"h1",0),a(1,"Invite people to Mastodon"),r(),o(2,"p",1),a(3,` Invite your friends elsewhere to come find you on Mastodon. Pick a message, edit it here if you like, then post it on X or Bluesky. Mawkingbird doesn\u2019t connect to either account \u2014 the button just opens their composer with the text filled in, and you send it.
`),r(),o(4,"div",2)(5,"button",3),u("click",function(){return n.setNetwork("x")}),a(6," Twitter (X) "),r(),o(7,"button",4),u("click",function(){return n.setNetwork("bluesky")}),a(8," Bluesky "),r()(),o(9,"div",5),v(10,q,2,0,"p",6)(11,Q,5,1,"p",6),o(12,"label",7)(13,"input",8),u("change",function(d){return n.toggleProfile(d.target.checked)}),r(),o(14,"span"),a(15," Include my Mastodon profile "),v(16,Z,2,1,"span",6)(17,ee,5,0,"span",6),r()(),o(18,"p",6),a(19," Only your public profile link goes in the post. Nothing else about this browser \u2014 no tokens, no server API URLs, no account IDs \u2014 is ever put in the message. "),r(),o(20,"button",9),u("click",function(){return n.shuffle()}),a(21," Shuffle \u2014 show a different one first "),r()(),o(22,"ul",10),$(23,re,19,18,"li",11,K),r(),v(25,le,10,1,"div",12),o(26,"p",13),a(27," Looking for invite links to your own server instead? "),o(28,"a",14),a(29,"Settings \u2192 Invites"),r(),a(30," generates those. To find people you already know, try "),o(31,"a",15),a(32,"Find my friends"),r(),a(33,`.
`),r()),t&2){let l;s(5),C("active",n.network()==="x"),x("aria-selected",n.network()==="x"),s(2),C("active",n.network()==="bluesky"),x("aria-selected",n.network()==="bluesky"),s(2),x("aria-labelledby","invite-tab-"+n.network()),s(),g(n.network()==="x"?10:11),s(3),M("checked",n.naming())("disabled",!n.hasProfile()),s(3),g(n.hasProfile()?16:17),s(7),L(n.cards()),s(2),g((l=n.fallbackText())?25:-1,l)}},dependencies:[B],styles:[".page-title[_ngcontent-%COMP%], .page-intro[_ngcontent-%COMP%]{padding:0 16px}.page-title[_ngcontent-%COMP%]{margin:0 0 4px}.small[_ngcontent-%COMP%]{font-size:13px}.warn[_ngcontent-%COMP%]{color:#e0245e}.sr-only[_ngcontent-%COMP%]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.tabs[_ngcontent-%COMP%]{margin-top:12px}.invite-intro[_ngcontent-%COMP%]{display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:14px 16px;border-bottom:1px solid var(--border)}.invite-intro[_ngcontent-%COMP%]   p[_ngcontent-%COMP%]{margin:0}.profile-toggle[_ngcontent-%COMP%]{display:flex;gap:8px;align-items:baseline;cursor:pointer}.profile-toggle[_ngcontent-%COMP%]   input[_ngcontent-%COMP%]{flex:none;margin-top:3px}.invite-list[_ngcontent-%COMP%]{list-style:none;margin:0;padding:0}.invite-card[_ngcontent-%COMP%]{padding:16px;border-bottom:1px solid var(--border)}.invite-head[_ngcontent-%COMP%]{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.invite-head[_ngcontent-%COMP%]   h2[_ngcontent-%COMP%]{margin:0;font-size:16px}.count[_ngcontent-%COMP%]{flex:none;font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted)}.count.over[_ngcontent-%COMP%]{color:#e0245e;font-weight:700}.invite-text[_ngcontent-%COMP%]{display:block;width:100%;margin:8px 0;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--col-bg);color:var(--text);line-height:1.45;resize:vertical;field-sizing:content;min-height:5lh}.invite-actions[_ngcontent-%COMP%]{display:flex;flex-wrap:wrap;align-items:center;gap:8px}a.btn[_ngcontent-%COMP%], a.btn[_ngcontent-%COMP%]:hover{text-decoration:none}.link[_ngcontent-%COMP%]{border:none;background:none;padding:0;color:var(--accent);font-size:13px;text-decoration:underline}.copy-note[_ngcontent-%COMP%]{font-size:13px;color:var(--muted)}.overlay[_ngcontent-%COMP%]{position:fixed;inset:0;z-index:110;display:flex;align-items:center;justify-content:center;padding:16px;background:#0006}.dialog[_ngcontent-%COMP%]{width:480px;max-width:100%;padding:24px;border-radius:16px;background:var(--col-bg)}.dialog[_ngcontent-%COMP%]   h2[_ngcontent-%COMP%]{margin:0 0 8px;font-size:18px}.footnote[_ngcontent-%COMP%]{padding:16px 16px 32px}"]})};export{H as Invites};
