import {wheelColour} from './progression.mjs';
export const ROW_GROUPS=Array.from({length:12},(_,i)=>({id:'row-'+i,label:`${i*3+1}–${i*3+3}`,name:`Row ${i*3+1}, ${i*3+2}, ${i*3+3}`,numbers:[i*3+1,i*3+2,i*3+3]}));
const all=Array.from({length:36},(_,i)=>i+1);
export const ROULETTE_GROUPS=[...ROW_GROUPS,
  ...Array.from({length:3},(_,i)=>({id:'column-'+i,label:'Column '+(i+1),name:'Column '+(i+1),numbers:all.filter(n=>(n-1)%3===i)})),
  ...Array.from({length:3},(_,i)=>({id:'dozen-'+i,label:`${i*12+1}–${i*12+12}`,name:['First dozen','Second dozen','Third dozen'][i],numbers:all.slice(i*12,i*12+12)})),
  {id:'low',label:'1–18',name:'Low numbers',numbers:all.filter(n=>n<=18)},
  {id:'even',label:'Even',name:'Even numbers',numbers:all.filter(n=>n%2===0)},
  {id:'red',label:'Red',name:'Red numbers',numbers:all.filter(n=>wheelColour(n)==='red')},
  {id:'black',label:'Black',name:'Black numbers',numbers:all.filter(n=>wheelColour(n)==='black')},
  {id:'odd',label:'Odd',name:'Odd numbers',numbers:all.filter(n=>n%2===1)},
  {id:'high',label:'19–36',name:'High numbers',numbers:all.filter(n=>n>=19)}];
export function rouletteGroup(id){return ROULETTE_GROUPS.find(g=>g.id===id)??null;}
export function toggleNumber(highlights,n){if(!Number.isInteger(n)||n<0||n>36)return highlights;return highlights.includes(n)?highlights.filter(x=>x!==n):[...highlights,n].sort((a,b)=>a-b);}
