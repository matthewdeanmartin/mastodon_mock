import{b as g}from"./chunk-YYT5NNRP.js";import{N as c,ia as s}from"./chunk-VTBHVOV7.js";import{a as l,b as u}from"./chunk-2NFLSA4Y.js";var h="mockingbird_github_token",f="https://api.github.com",p="2026-03-10",d=class n{tokenKey=g(h);token=s(y(this.tokenKey));user=s(this.token()?.user??null);connected=s(this.token()!==null);notifications=s(null);following=s(null);async connect(t){let e=t.trim();if(!e)throw new Error("Paste a GitHub personal access token (classic).");let r=await a("/user",e),o={accessToken:e,user:r};return localStorage.setItem(this.tokenKey,JSON.stringify(o)),this.token.set(o),this.user.set(r),this.connected.set(!0),r}async runProof(){let t=this.token()?.accessToken;if(!t)throw new Error("Connect GitHub first.");try{let[e,r]=await Promise.all([a("/notifications?all=false&participating=false&per_page=10",t),a("/user/following?per_page=10",t)]);this.notifications.set(e),this.following.set(r)}catch(e){throw e instanceof i&&e.status===401&&this.disconnect(),e}}async followedUsers(t=null){let e=await this.graphQl(w,t),r=e.data?.viewer?.following;if(!r)throw new Error(e.errors?.[0]?.message??"GitHub did not return followed accounts.");return{users:r.nodes,hasNextPage:r.pageInfo.hasNextPage,endCursor:r.pageInfo.endCursor}}async starredRepositoryOwners(t=null){let e=await this.graphQl(m,t),r=e.data?.viewer?.starredRepositories;if(!r)throw new Error(e.errors?.[0]?.message??"GitHub did not return your starred repositories.");return{owners:r.nodes.map(({owner:o})=>u(l({},o),{bio:o.bio??o.description??null,socialAccounts:o.socialAccounts??{nodes:[]}})),repositoryCount:r.nodes.length,hasNextPage:r.pageInfo.hasNextPage,endCursor:r.pageInfo.endCursor}}disconnect(){localStorage.removeItem(this.tokenKey),this.token.set(null),this.user.set(null),this.connected.set(!1),this.notifications.set(null),this.following.set(null)}async graphQl(t,e){let r=this.token()?.accessToken;if(!r)throw new Error("Connect GitHub first.");let o=await fetch(`${f}/graphql`,{method:"POST",headers:{Authorization:`Bearer ${r}`,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":p},body:JSON.stringify({query:t,variables:{cursor:e}})});if(!o.ok)throw o.status===401&&this.disconnect(),new i(o.status,await b(o));return await o.json()}static \u0275fac=function(e){return new(e||n)};static \u0275prov=c({token:n,factory:n.\u0275fac,providedIn:"root"})},w=`
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
`,m=`
  query StarredRepositoryOwners($cursor: String) {
    viewer {
      starredRepositories(
        first: 100
        after: $cursor
        orderBy: { field: STARRED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          owner {
            login
            avatarUrl
            url
            ... on User {
              name
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
            ... on Organization {
              name
              description
              websiteUrl
            }
          }
        }
      }
    }
  }
`,i=class extends Error{constructor(e,r){super(r);this.status=e}};async function a(n,t){let e=await fetch(`${f}${n}`,{headers:{Authorization:`Bearer ${t}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":p}});if(!e.ok)throw new i(e.status,await b(e));return await e.json()}async function b(n){try{let t=await n.json();return n.status===401?"GitHub rejected that token. Check that it is active, then try again.":n.status===403&&t.message?.toLowerCase().includes("scope")?"That token is missing the notifications scope.":t.message??`GitHub returned HTTP ${n.status}.`}catch{return`GitHub returned HTTP ${n.status}.`}}function y(n){try{let t=JSON.parse(localStorage.getItem(n)??"null");return typeof t?.accessToken!="string"||!t.accessToken||typeof t.user?.login!="string"?null:t}catch{return localStorage.removeItem(n),null}}export{d as a};
