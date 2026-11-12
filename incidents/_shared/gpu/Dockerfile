FROM vllm/vllm-openai:v0.31.0
COPY serve.py /opt/homeops-gpu/serve.py
COPY prepare.py /opt/homeops-gpu/prepare.py
ENTRYPOINT ["python3", "-u", "/opt/homeops-gpu/serve.py"]
