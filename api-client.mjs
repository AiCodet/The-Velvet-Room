let csrf='';
export function setSession(value){csrf=value??'';}
export async function api(method,path,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch('/api'+path,{method,credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','X-Velvet-Client':'web',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();if(!response.ok){const error=new Error(result.error??'Request failed.');error.status=response.status;throw error;}return result;}
  catch(e){if(e.name==='AbortError')throw new Error('The server took too long. Refresh to check whether your move was saved.');throw e;}finally{clearTimeout(timer);}
}
