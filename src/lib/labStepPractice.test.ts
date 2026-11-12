import { describe, expect, it } from 'vitest'
import { guidedLabTasks, labQuestions, labStepChecks, labSteps } from '../data/labSteps'
import { checkOutput, commandHints, hideCommands, outputFact } from './labStepPractice'

describe('lab step self-checks',()=>{
  it('gives every existing step a command, scope and expected observation',()=>{for(const [id,steps] of Object.entries(labSteps)){expect(labStepChecks[id],id).toHaveLength(steps.length);for(const c of labStepChecks[id])expect([c.command,c.expected,c.scope].every((v)=>v.trim().length>0),id).toBe(true)}for(const id of guidedLabTasks)expect(labSteps[id]).toBeDefined()})
  it('reveals one command at a time while leaving file paths readable',()=>{const text='В `gateway/app.py` выполните `uv run pytest` и `uv run mypy src`.';const hints=commandHints(text);expect(hideCommands(text,hints,0)).toContain('`gateway/app.py`');expect(hideCommands(text,hints,1)).toContain('`uv run pytest`');expect(hideCommands(text,hints,1)).not.toContain('uv run mypy')})
  it('compares with a single actual output, including decimal and scientific notation',()=>{const q=labQuestions.C3[0];if(q.kind!=='output')throw Error('Fixture');expect(checkOutput(q,'{"p95_ttft_ms":180.5}','180,5')).toBe('correct');expect(checkOutput(q,'P95 TTFT (ms): 180.5','180')).toBe('wrong');expect(outputFact(q,'{"p95_ttft_ms":1e3}')).toBe(1000);expect(outputFact(q,'{"p95_ttft_ms":-1}')).toBeNull();expect(outputFact(q,'P95 TTFT (ms): 100\nP95 TTFT (ms): 200')).toBeNull()})
})
