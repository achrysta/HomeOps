/** Связи существующих контрольных вопросов с тем, что они действительно проверяют. */
export const diagnosticSkills: Record<string,string[]> = {
  'aq-1':['python','async-pipelines'],'aq-2':['python','async-pipelines'],'aq-3':['python','llm-gateway'],'aq-4':['llm-gateway'],
  'bq-1':['ml-lifecycle','model-serving'],'bq-2':['ml-lifecycle','experiment-tracking'],'bq-3':['experiment-tracking','model-serving'],'bq-4':['delivery','model-serving'],
  'cq-1':['llm-slo','vllm'],'cq-2':['inference-optimization'],'cq-3':['vllm','inference-optimization'],'cq-4':['vllm','model-serving'],
  'dq-1':['llm-slo','ml-monitoring'],'dq-2':['llm-slo','ml-monitoring'],'dq-3':['ml-monitoring'],'dq-4':['vllm','ml-monitoring'],
  'eq-1':['retrieval-metrics'],'eq-2':['retrieval-metrics'],'eq-3':['retrieval-metrics','golden-datasets'],'eq-4':['retrieval-metrics'],
  'fq-1':['golden-datasets','llm-eval'],'fq-2':['golden-datasets','llm-eval'],'fq-3':['llm-eval'],'fq-4':['golden-datasets','llm-eval'],
  'gq-1':['eval-gates','cicd'],'gq-2':['eval-gates','gitlab-ci'],'gq-3':['eval-gates'],'gq-4':['gitlab-ci','cicd'],
  'hq-1':['gpu-clusters','kubernetes'],'hq-2':['gpu-clusters','docker'],'hq-3':['gpu-clusters','kubernetes'],'hq-4':['gpu-clusters'],
  // трек K: IaC и GitOps для платформы
  'kq-1':['terraform'],'kq-6':['terraform'],'kq-11':['terraform'],'kq-14':['terraform'],'kq-21':['iac'],'kq-23':['iac'],'kq-27':['gitops-delivery'],'kq-30':['gitops-delivery','kubernetes'],'kq-33':['gitops-delivery'],
  // пачка 10: оркестрация пайплайнов, serving в Kubernetes, GitOps, агенты, дообучение
  'bq-35':['ml-lifecycle','pipeline-orchestration'],'bq-37':['pipeline-orchestration'],'bq-38':['pipeline-orchestration','ml-lifecycle'],'bq-39':['pipeline-orchestration'],
  'gq-15':['cicd','gitops-delivery'],'gq-25':['gitops-delivery','cicd'],
  'gq-37':['k8s-model-serving','model-serving'],'gq-38':['k8s-model-serving','kubernetes'],'gq-39':['k8s-model-serving','gitops-delivery'],
  'iq-1':['agents'],'iq-16':['agents'],'iq-19':['agents'],'iq-26':['agents','llm-eval'],'iq-31':['agents'],
  'jq-1':['fine-tuning','llm-eval'],'jq-2':['fine-tuning'],'jq-4':['fine-tuning'],'jq-18':['fine-tuning'],'jq-22':['fine-tuning','vllm'],'jq-27':['fine-tuning','llm-eval'],
}
