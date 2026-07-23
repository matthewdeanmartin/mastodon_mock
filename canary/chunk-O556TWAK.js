import{b as c}from"./chunk-YYT5NNRP.js";import{N as u,ia as s}from"./chunk-VTBHVOV7.js";var h="mockingbird_github_token",d="https://api.github.com",f="2026-03-10",g=class n{tokenKey=c(h);token=s(w(this.tokenKey));user=s(this.token()?.user??null);connected=s(this.token()!==null);notifications=s(null);following=s(null);async connect(e){let t=e.trim();if(!t)throw new Error("Paste a GitHub personal access token (classic).");let o=await l("/user",t),r={accessToken:t,user:o};return localStorage.setItem(this.tokenKey,JSON.stringify(r)),this.token.set(r),this.user.set(o),this.connected.set(!0),o}async runProof(){let e=this.token()?.accessToken;if(!e)throw new Error("Connect GitHub first.");try{let[t,o]=await Promise.all([l("/notifications?all=false&participating=false&per_page=10",e),l("/user/following?per_page=10",e)]);this.notifications.set(t),this.following.set(o)}catch(t){throw t instanceof i&&t.status===401&&this.disconnect(),t}}async followedUsers(e=null){let t=this.token()?.accessToken;if(!t)throw new Error("Connect GitHub first.");let o=await fetch(`${d}/graphql`,{method:"POST",headers:{Authorization:`Bearer ${t}`,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":f},body:JSON.stringify({query:p,variables:{cursor:e}})});if(!o.ok)throw o.status===401&&this.disconnect(),new i(o.status,await b(o));let r=await o.json(),a=r.data?.viewer?.following;if(!a)throw new Error(r.errors?.[0]?.message??"GitHub did not return followed accounts.");return{users:a.nodes,hasNextPage:a.pageInfo.hasNextPage,endCursor:a.pageInfo.endCursor}}disconnect(){localStorage.removeItem(this.tokenKey),this.token.set(null),this.user.set(null),this.connected.set(!1),this.notifications.set(null),this.following.set(null)}static \u0275fac=function(t){return new(t||n)};static \u0275prov=u({token:n,factory:n.\u0275fac,providedIn:"root"})},p=`
  query FollowedUsers($cursor: String) {
    viewer {
      following(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          login
          name
          avatarUrl
          url
          bio
          websiteUrl
          socialAccounts(first: 10) {
            nodes {
              provider
              displayName
              url
            }
          }
        }
      }
    }
  }
`,i=class extends Error{constructor(t,o){super(o);this.status=t}};async function l(n,e){let t=await fetch(`${d}${n}`,{headers:{Authorization:`Bearer ${e}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":f}});if(!t.ok)throw new i(t.status,await b(t));return await t.json()}async function b(n){try{let e=await n.json();return n.status===401?"GitHub rejected that token. Check that it is active, then try again.":n.status===403&&e.message?.toLowerCase().includes("scope")?"That token is missing the notifications scope.":e.message??`GitHub returned HTTP ${n.status}.`}catch{return`GitHub returned HTTP ${n.status}.`}}function w(n){try{let e=JSON.parse(localStorage.getItem(n)??"null");return typeof e?.accessToken!="string"||!e.accessToken||typeof e.user?.login!="string"?null:e}catch{return localStorage.removeItem(n),null}}export{g as a};
