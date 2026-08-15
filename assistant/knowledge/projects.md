# Projects

## DocIntel — AI Document Intelligence (Flagship · Enterprise RAG Platform)
Category: GenAI. Tech: FastAPI · Chroma · Supabase.

Upload any document and get AI classification, summarisation, and citation-backed Q&A through a production RAG pipeline: FastEmbed (ONNX) embeddings + Chroma vector search, with a multi-provider LLM abstraction (Gemini, Groq, OpenAI, Anthropic) and automatic fallback. Sub-second retrieval across 1000+ chunks; embedding footprint cut from ~4GB to ~400MB; 95%+ uptime on a 16GB free tier. Supports 6 document formats.

Key tech: FastAPI, RAG, Chroma, FastEmbed, Supabase pgvector, Gemini, JWT/JWKS, Docker, React.
Repo: https://github.com/ksubodh9/DocIntel-AI-powered-Document-Intelligence

## LaraOpsCopilot — AI Operations Copilot (Flagship · AI Copilot)
Category: GenAI. Tech: FastAPI · FAISS · NL→SQL.

A drop-in AI operations layer for any Laravel app. Ask in plain English and get answers from three AI agents served by a FastAPI backend: a **Database** agent that turns natural language into guarded, read-only SQL behind a dual AST-based SQL guard and approval flow; a **Log** agent that PII-masks logs, clusters errors by signature, and writes LLM root-cause narratives; and a **Knowledge Base** agent doing chunk → embed → FAISS → cited RAG answers. A swappable LLM/embedding provider abstraction (Anthropic, OpenAI, Gemini, Ollama + offline echo) lets the whole system run and test fully offline. Every action is role-gated and audited. 40 test files.

Key tech: FastAPI, RAG, FAISS, NL→SQL, sqlglot, Log RCA, OpenAPI, HMAC, DDD, Laravel.
Case study: resources/case-studies/portfolio-laraopscopilot-sanitized.html

## Smart AI Assistant (GenAI · RAG)
Category: GenAI. Tech: FAISS · LLM.

An end-to-end RAG-powered conversational assistant with semantic search, bilingual (English/Hindi) support, and auto error detection. A FAISS-indexed pipeline with context-aware generation that reduced repetitive support queries by ~40% in production.
Repo: https://github.com/ksubodh9/smart-ai-assistant

## Guidora AI (AI Recommendation)
Category: GenAI. Tech: FastAPI · FAISS.

A personalised AI career-guidance platform with a custom RAG pipeline and voice-enabled interaction. FAISS vector retrieval for context-aware responses over a guidance knowledge base, on a scalable FastAPI backend with JWT auth and modular service design.
Repo: https://github.com/ksubodh9

## Predictive Maintenance Platform (ML Systems)
Category: ML. Tech: XGBoost · SHAP.

Detects industrial equipment faults before they cause downtime, using a Random Forest + XGBoost ensemble over sensor data (vibration, temperature, pressure) with wavelet feature engineering and SHAP explainability. 85%+ accuracy, sub-100ms inference, served via FastAPI + a live Streamlit dashboard.
Repo: https://github.com/ksubodh9/AI-Based-Industrial-Equipment-Health-Predictive-Maintenance

## Churn & House Price Prediction (Full-Stack ML)
Category: ML. Tech: FastAPI · Streamlit.

A full-stack ML dashboard with dual prediction models behind a clean FastAPI + SQLModel backend. Compared Logistic Regression, Random Forest, Gradient Boosting, AdaBoost & XGBoost with reusable preprocessing pipelines — ~80% churn accuracy across three deployment modes.
Live app: https://share.streamlit.io/user/ksubodh9

## Walmart Sales Forecasting (Data Science)
Category: ML. Tech: ARIMA · SARIMA.

Time-series demand forecasting for retail planning, with trend and seasonality decomposition. Regression + ARIMA/SARIMA models with temporal feature engineering over historical sales — a foundation for inventory, staffing, and supply-chain optimisation.
Repo: https://github.com/ksubodh9/wallmart

## MaddoxPay — Production Fintech Platform (Backend Foundation · Fintech)
Category: Backend. Tech: Laravel · MySQL · FastAPI.

The backend engineering foundation behind the AI work: a high-volume financial-services platform built end-to-end — 100K+ monthly transactions, ₹1M+ daily payouts via Axis Bank — and where Subodh first put ML into production for anomaly detection and fraud insight via FastAPI.
Case study: resources/case-studies/portfolio-fintech-platform-sanitized.html
