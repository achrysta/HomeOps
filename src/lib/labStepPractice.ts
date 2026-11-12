import type { LabQuestion } from '../data/labSteps'

export function commandHints(text:string):string[]{return [...new Set([...text.matchAll(/`([^`]+)`/g)].map((m)=>m[1]).filter((s)=>/^(uv |python|docker |kubectl |helm |curl |vllm |promtool |nvidia-smi|git |make |terraform |ansible|--[a-z])/.test(s)))]}
export function hideCommands(text:string,hints:readonly string[],revealed:number):string{const hidden=hints.slice(revealed);return text.replace(/`([^`]+)`/g,(whole,code:string)=>hidden.includes(code)?'«команда в подсказке»':whole)}

/** Сверка с фактом из вставленного вывода, а не с выдуманным эталонным benchmark. */
export function outputFact(question:Extract<LabQuestion,{kind:'output'}>,output:string):number|null {
  const re=question.field==='ttft'?/(?:p95_ttft_ms|ttft_p95_ms|P95\s+TTFT\s*\(ms\))"?\s*[:=]\s*([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)/gi:/(?:recall_at_5|recall@5)"?\s*[:=]\s*([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)/gi
  const values=[...output.matchAll(re)].map((m)=>Number(m[1].replace(',','.')))
  if(values.length!==1||!Number.isFinite(values[0])||values[0]<0||(question.field==='recall'&&values[0]>1))return null
  return values[0]
}
export function checkOutput(question:Extract<LabQuestion,{kind:'output'}>,output:string,answer:string):'missing'|'correct'|'wrong'{const n=outputFact(question,output);if(n===null||!answer.trim())return 'missing';return Number(answer.replace(',','.'))===n?'correct':'wrong'}
