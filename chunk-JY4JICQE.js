import{b}from"./chunk-YYT5NNRP.js";import{N as w,ia as i}from"./chunk-4QMMT3ZC.js";import{a as p,b as f}from"./chunk-2NFLSA4Y.js";var H="mockingbird_github_token",m="https://api.github.com",y="2026-03-10",h=class n{tokenKey=b(H);token=i(v(this.tokenKey));user=i(this.token()?.user??null);connected=i(this.token()!==null);notifications=i(null);following=i(null);async connect(t){let e=t.trim();if(!e)throw new Error("Paste a GitHub personal access token (classic).");let r=await l("/user",e),o={accessToken:e,user:r};return localStorage.setItem(this.tokenKey,JSON.stringify(o)),this.token.set(o),this.user.set(r),this.connected.set(!0),r}async runProof(){let t=this.token()?.accessToken;if(!t)throw new Error("Connect GitHub first.");try{let[e,r]=await Promise.all([l("/notifications?all=false&participating=false&per_page=10",t),l("/user/following?per_page=10",t)]);this.notifications.set(e),this.following.set(r)}catch(e){throw e instanceof a&&e.status===401&&this.disconnect(),e}}async followedUsers(t=null){let e=await this.graphQl(k,t),r=e.data?.viewer?.following;if(!r)throw new Error(e.errors?.[0]?.message??"GitHub did not return followed accounts.");return{users:r.nodes,hasNextPage:r.pageInfo.hasNextPage,endCursor:r.pageInfo.endCursor}}async starredRepositoryOwners(t=null){let e=await this.graphQl(S,t),r=e.data?.viewer?.starredRepositories;if(!r)throw new Error(e.errors?.[0]?.message??"GitHub did not return your starred repositories.");let o=new Map;for(let s of r.nodes){let u=f(p({},s.owner),{bio:s.owner.bio??s.owner.description??null,socialAccounts:s.owner.socialAccounts??{nodes:[]}}),c=u.login.toLowerCase(),g=o.get(c),d={nameWithOwner:s.nameWithOwner,url:s.url,description:s.description};g?g.repositories.push(d):o.set(c,{profile:u,repositories:[d]})}return{owners:[...o.values()],repositoryCount:r.nodes.length,hasNextPage:r.pageInfo.hasNextPage,endCursor:r.pageInfo.endCursor}}disconnect(){localStorage.removeItem(this.tokenKey),this.token.set(null),this.user.set(null),this.connected.set(!1),this.notifications.set(null),this.following.set(null)}async graphQl(t,e){let r=this.token()?.accessToken;if(!r)throw new Error("Connect GitHub first.");let o=await fetch(`${m}/graphql`,{method:"POST",headers:{Authorization:`Bearer ${r}`,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":y},body:JSON.stringify({query:t,variables:{cursor:e}})});if(!o.ok)throw o.status===401&&this.disconnect(),new a(o.status,await G(o));return await o.json()}static \u0275fac=function(e){return new(e||n)};static \u0275prov=w({token:n,factory:n.\u0275fac,providedIn:"root"})},k=`
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
`,S=`
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
          nameWithOwner
          url
          description
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
`,a=class extends Error{constructor(e,r){super(r);this.status=e}};async function l(n,t){let e=await fetch(`${m}${n}`,{headers:{Authorization:`Bearer ${t}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":y}});if(!e.ok)throw new a(e.status,await G(e));return await e.json()}async function G(n){try{let t=await n.json();return n.status===401?"GitHub rejected that token. Check that it is active, then try again.":n.status===403&&t.message?.toLowerCase().includes("scope")?"That token is missing the notifications scope.":t.message??`GitHub returned HTTP ${n.status}.`}catch{return`GitHub returned HTTP ${n.status}.`}}function v(n){try{let t=JSON.parse(localStorage.getItem(n)??"null");return typeof t?.accessToken!="string"||!t.accessToken||typeof t.user?.login!="string"?null:t}catch{return localStorage.removeItem(n),null}}export{h as a};
