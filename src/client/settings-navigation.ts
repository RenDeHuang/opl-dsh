/** Official 0.1.7 exposes section labels/order but no custom navigation icon slot.
 * Apply an OPL-owned presentation to our four entries; keep native buttons and navigation.
 */
export function installSettingsNavigation(): () => void {
  const entries: Record<string,{id:string;path:string}> = {
    'OPL Gateway': {id:'gateway',path:'M9 7H7a5 5 0 0 0 0 10h3m5-10h2a5 5 0 0 1 0 10h-3M8 12h8'},
    'Harness': {id:'harness',path:'M4 5h16v14H4zM7 9l3 3-3 3m6 0h4'},
    '运行配置': {id:'profiles',path:'M5 4v16m7-16v16m7-16v16M2 9h6m1 7h6m1-10h6'},
    '协作与自动化': {id:'collaboration',path:'M4 7h13l-3-3m6 13H7l3 3M17 7l-3 3m-7 7 3-3'},
  }
  const style=document.createElement('style')
  style.textContent=Object.values(entries).map(({id,path})=>{
    const svg=encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`)
    return `[data-opl-navigation="${id}"]>svg{background:currentColor;mask:url("data:image/svg+xml,${svg}") center/contain no-repeat}[data-opl-navigation="${id}"]>svg>*{visibility:hidden}`
  }).join('')
  document.head.append(style)
  const refresh=()=>{
    for(const button of document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button')){
      const entry=entries[button.textContent?.trim()??'']
      if(entry&&button.dataset.oplNavigation!==entry.id)button.dataset.oplNavigation=entry.id
      else if(!entry&&button.dataset.oplNavigation)delete button.dataset.oplNavigation
    }
  }
  const observer=new MutationObserver(refresh)
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});refresh()
  return ()=>{observer.disconnect();style.remove();for(const button of document.querySelectorAll<HTMLElement>('[data-opl-navigation]'))delete button.dataset.oplNavigation}
}
