
const LS_KEYS={ TASKS:'bp_tasks', CLIENTS:'bp_clients' };
export const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const read=(k)=>{try{const r=localStorage.getItem(k);return r?JSON.parse(r):[]}catch{return []}};
const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
export const getTasks=()=>read(LS_KEYS.TASKS); export const saveTasks=(a)=>write(LS_KEYS.TASKS,a);
export const getClients=()=>read(LS_KEYS.CLIENTS); export const saveClients=(a)=>write(LS_KEYS.CLIENTS,a);
export function ensureSeed(){ if(getClients().length===0){ saveClients([
  { id:uid(), name:'ООО «Вектор»', inn:'7701234567', contact:'Иван Петров', phone:'+7 900 111-22-33', notes:'Основной клиент' },
  { id:uid(), name:'ИП «Альфа»', inn:'7722334455', contact:'Анна Соколова', phone:'+7 900 444-55-66', notes:'' },
]); }
if(getTasks().length===0){ saveTasks([
  { id:uid(), title:'Подготовить договор', description:'Проверить условия и отправить на подпись', status:'open', dueDate:'2025-11-20', createdBy:'client' },
  { id:uid(), title:'Сверка по счетам', description:'Период: октябрь', status:'in_progress', dueDate:'2025-11-18', createdBy:'admin' },
  { id:uid(), title:'План отгрузок', description:'Составить график', status:'open', dueDate:'2025-11-22', createdBy:'client' },
]); } }
