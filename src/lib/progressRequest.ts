import { PROGRESS_REQUEST_TIMEOUT_MS } from '../config/learning'

/** Deadline охватывает и fetch, и чтение тела; даже transport, игнорирующий abort, не держит очередь. */
export async function progressRequest<T>(input:string,init:RequestInit|undefined,read:(response:Response)=>Promise<T>):Promise<T|null>{
  const controller=new AbortController()
  let timer:ReturnType<typeof setTimeout>|undefined
  const stop=()=>controller.abort()
  init?.signal?.addEventListener('abort',stop,{once:true})
  if(init?.signal?.aborted)controller.abort()
  try{
    const expired=new Promise<null>((resolve)=>{timer=setTimeout(()=>{controller.abort();resolve(null)},PROGRESS_REQUEST_TIMEOUT_MS)})
    const request=fetch(input,{...init,signal:controller.signal}).then(read).catch(()=>null)
    return await Promise.race([request,expired])
  }catch{return null}finally{clearTimeout(timer);init?.signal?.removeEventListener('abort',stop)}
}
