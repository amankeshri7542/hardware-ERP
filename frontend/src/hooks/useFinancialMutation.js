import { useEffect, useRef, useState } from 'react';
import useAuthStore from '../store/authStore.js';
import { readIntent, newIntent, executeIntent, clearIntent, intentStorageKey } from '../utils/financialIntent.js';
const recover = (userId,operation) => {
  try { return readIntent(localStorage,userId,operation); }
  catch { return {status:'storage_error',error:'Saved transaction recovery data is unavailable. Resolve browser storage before creating another transaction.'}; }
};
export function useFinancialMutation(operation, send) {
  const userId = useAuthStore(state => state.user?.id);
  const [saved,setSaved] = useState(()=>({userId,intent:recover(userId,operation)}));
  const intent=saved.userId===userId ? saved.intent : recover(userId,operation);
  const setIntent = value => setSaved({userId,intent:value});
  const [busy,setBusy] = useState(false);
  const exclusive = useRef(false);
  useEffect(()=>{
    setSaved({userId,intent:recover(userId,operation)});
    const changed = event => { if(event.key===intentStorageKey(userId,operation)) setSaved({userId,intent:recover(userId,operation)}); };
    window.addEventListener('storage',changed);return ()=>window.removeEventListener('storage',changed);
  },[userId,operation]);
  const lockedRun = async action => {
    if(exclusive.current || useAuthStore.getState().user?.id!==userId) return null;
    exclusive.current=true;setBusy(true);
    try {
      if(!navigator.locks?.request) throw new Error('This browser cannot safely coordinate financial requests. Use a supported secure browser.');
      return await navigator.locks.request(intentStorageKey(userId,operation),async()=>{
        if(useAuthStore.getState().user?.id!==userId) return null;
        return action();
      });
    } catch(error) {setIntent({status:'storage_error',error:error.message || 'Recovery storage is unavailable. No new request was sent.'});return null;}
    finally {exclusive.current=false;setBusy(false);}
  };
  const run = (payload,snapshot) => lockedRun(async()=>{
    let current=readIntent(localStorage,userId,operation);
    // A separate tab's operation is shown for recovery; never replace it with this draft.
    if(current && (!intent || current.key!==intent.key)) {setIntent(current);return current;}
    if(!current) {
      if(!payload) throw new Error('No saved transaction is available to retry.');
      current=newIntent(payload,snapshot,userId);
    }
    if(['completed','rejected'].includes(current.status)) {setIntent(current);return current;}
    setIntent(current);
    const result=await executeIntent(localStorage,userId,operation,current,send);
    setIntent(result);return result;
  });
  const clear = () => lockedRun(async()=>{clearIntent(localStorage,userId,operation,intent);setIntent(null);return true;});
  return {intent,busy,run,clear,locked:!!intent};
}
