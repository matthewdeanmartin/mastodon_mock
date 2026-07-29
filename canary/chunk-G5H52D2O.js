import{b as w}from"./chunk-7XG4JRWK.js";import{N as a,ia as i}from"./chunk-WYMZ4PJU.js";import{a as p,b}from"./chunk-7CGTOI24.js";var O="https://openrouter.ai/api/v1/models",S=20,c="google/gemma-4-31b-it",D="structured_outputs",v=class t{cache=new Map;searching=i(!1);async search(e,r={}){let o=r.structuredOnly??!0,h=e.trim()||c,g=`${h}::${o}`,f=this.cache.get(g);if(f)return f;let l=new URL(O);l.searchParams.set("q",h),l.searchParams.set("limit",String(S)),o&&l.searchParams.set("supported_parameters",D),this.searching.set(!0);try{let d=await fetch(l.toString());if(!d.ok)throw new Error(await w(d,"Couldn't reach OpenRouter's model list."));let y=((await d.json()).data??[]).filter(s=>typeof s.id=="string").map(s=>({id:s.id,name:s.name??s.id,contextLength:s.context_length??null,promptPrice:P(s.pricing?.prompt),completionPrice:P(s.pricing?.completion)}));return this.cache.set(g,y),y}finally{this.searching.set(!1)}}static \u0275fac=function(r){return new(r||t)};static \u0275prov=a({token:t,factory:t.\u0275fac,providedIn:"root"})};function P(t){if(t===void 0)return null;let e=Number(t);return Number.isFinite(e)?e:null}function j(t){if(t===null)return null;if(t===0)return"free";let e=t*1e6;return`$${e<.01?e.toFixed(4):e.toFixed(2)} / M tokens`}var u="mockingbird_openrouter_model",T=class t{modelId=i(k());set(e){let r=e.trim();if(r){try{localStorage.setItem(u,r)}catch{}this.modelId.set(r)}}reset(){try{localStorage.removeItem(u)}catch{}this.modelId.set(c)}isDefault(){return this.modelId()===c}static \u0275fac=function(r){return new(r||t)};static \u0275prov=a({token:t,factory:t.\u0275fac,providedIn:"root"})};function k(){try{return localStorage.getItem(u)||c}catch{return c}}var m="mockingbird_openrouter_prompts",x=[{id:"search",label:"Search helper",description:"Turns what you typed into five runnable Mastodon search queries, then improves them once if they returned too little.",placeholders:["request","context","feedback"]},{id:"tag",label:"Tag helper",description:"Suggests hashtags for a post you are writing, then improves them once if the suggested tags turn out to be dead.",placeholders:["post","feedback"]}],M={search:`You write search queries for Mastodon, using its search syntax.

Supported operators \u2014 use ONLY these:
  +word            the word must appear
  "exact phrase"   the phrase must appear
  -word            the word must NOT appear
  from:@user@host  posted by this account
  before:YYYY-MM-DD / after:YYYY-MM-DD
  language:xx      two-letter language code
  has:media        has an image, video or audio
  has:poll         has a poll
  is:reply / -is:reply
  is:sensitive / -is:sensitive
  in:public        search all public posts
  in:library       search only posts you wrote or interacted with

Rules:
- Return exactly 5 queries, ordered most to least likely to be what they meant.
- Vary them: a narrow one, a couple of middling ones, and a broad fallback.
- Never invent an operator that is not listed above.
- Do not guess an account handle unless the request names one.
- Bare words are fine; not every query needs an operator.
- Respect the current state of the search form, described below.

If you cannot answer, say so in "problem" and return no queries. Do that when
the request asks for another service (Google, the web, YouTube), for something
this search cannot express (sorting, counting, anything about a specific user's
followers), or is too vague to guess at. One short sentence, addressed to the
person, saying what this search can do instead. Otherwise leave "problem" empty
\u2014 never use it to add commentary to a working answer.

The current state of the search form:
{{context}}

What the person is looking for:
{{request}}

{{feedback}}`,tag:`You suggest hashtags for a post being written on Mastodon.

On Mastodon, hashtags are the main way people find posts outside their follows,
so a good tag is one that other people actually browse.

Rules:
- Return exactly 5 hashtags, without the leading #.
- Prefer established, general tags over clever or invented ones.
- CamelCase multi-word tags (e.g. NaturePhotography) \u2014 it helps screen readers.
- No punctuation, spaces or emoji inside a tag.
- Suggest tags for what the post is *about*, not words that merely appear in it.

The post:
{{post}}

{{feedback}}`};function _(t,e){return t.replace(/\{\{(\w+)\}\}/g,(o,n)=>n in e?e[n]:o).replace(/\n{3,}/g,`

`).trim()}var R=class t{overrides=i(E());templates=x;text(e){return this.overrides()[e]??M[e]}isCustom(e){return this.overrides()[e]!==void 0}set(e,r){let o=r.trim();if(!o||o===M[e].trim()){this.reset(e);return}this.write(b(p({},this.overrides()),{[e]:o}))}reset(e){let r=p({},this.overrides());delete r[e],this.write(r)}render(e,r){return _(this.text(e),r)}write(e){try{Object.keys(e).length===0?localStorage.removeItem(m):localStorage.setItem(m,JSON.stringify(e))}catch{}this.overrides.set(e)}static \u0275fac=function(r){return new(r||t)};static \u0275prov=a({token:t,factory:t.\u0275fac,providedIn:"root"})};function E(){try{let t=localStorage.getItem(m);if(!t)return{};let e=JSON.parse(t),r={};for(let o of x){let n=e[o.id];typeof n=="string"&&n.trim()&&(r[o.id]=n)}return r}catch{return{}}}export{c as a,v as b,j as c,T as d,R as e};
