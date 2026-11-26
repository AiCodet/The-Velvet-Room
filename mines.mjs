import {secureRandom} from './engine.mjs';
export const MINE_SIZE=5, MINE_COUNT=5, MINE_MMR=1250;
export function neighbours(index,size=MINE_SIZE){
  const row=Math.floor(index/size),col=index%size,result=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const y=row+dy,x=col+dx;
    if((dy||dx)&&y>=0&&y<size&&x>=0&&x<size)result.push(y*size+x);
  }
  return result;
}
export function newMinefield(size=MINE_SIZE,count=MINE_COUNT){
  if(!Number.isInteger(size)||size<3||!Number.isInteger(count)||count<1||count>size*size-9)throw Error('Invalid minefield size or mine count');
  return {size,count,status:'ready',placed:false,cells:Array.from({length:size*size},()=>({mine:false,nearby:0,revealed:false,flagged:false})),moves:0,hit:null};
}
export function placeMines(board,firstIndex,random=secureRandom){
  if(board.placed)return;
  if(!Number.isInteger(firstIndex)||firstIndex<0||firstIndex>=board.cells.length)throw Error('Invalid first cell');
  const safe=new Set([firstIndex,...neighbours(firstIndex,board.size)]);
  const candidates=board.cells.map((_,i)=>i).filter(i=>!safe.has(i));
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  for(const i of candidates.slice(0,board.count))board.cells[i].mine=true;
  board.cells.forEach((cell,i)=>{cell.nearby=neighbours(i,board.size).filter(n=>board.cells[n].mine).length;});
  board.placed=true;board.status='playing';
}
export const mineProgress=board=>({revealed:board.cells.filter(c=>c.revealed&&!c.mine).length,total:board.cells.length-board.count,flags:board.cells.filter(c=>c.flagged).length});
export function revealCell(board,index,random=secureRandom){
  const cell=board.cells[index];
  if(!cell||['win','loss'].includes(board.status)||cell.revealed||cell.flagged)return false;
  if(!board.placed)placeMines(board,index,random);
  board.moves++;
  if(cell.mine){cell.revealed=true;board.status='loss';board.hit=index;return true;}
  const queue=[index],visited=new Set();
  while(queue.length){const i=queue.pop(),c=board.cells[i];if(visited.has(i)||c.flagged||c.mine)continue;visited.add(i);c.revealed=true;if(c.nearby===0)queue.push(...neighbours(i,board.size));}
  if(mineProgress(board).revealed===board.cells.length-board.count)board.status='win';
  return true;
}
export function toggleFlag(board,index){
  const cell=board.cells[index];
  if(!cell||cell.revealed||['win','loss'].includes(board.status))return false;
  if(!cell.flagged&&mineProgress(board).flags>=board.count)return false;
  cell.flagged=!cell.flagged;return true;
}
