# Legal Metrology Compliance Checker — MVP

A working prototype: upload a product label photo → OCR extracts text →
rule engine checks it against 5 core Legal Metrology (Packaged Commodities)
Rules, 2011 declarations → get a pass/fail report + downloadable PDF.

## What's included
- `main.py` — FastAPI backend: image preprocessing (OpenCV), OCR (Tesseract),
  rule engine, PDF report generation (ReportLab)
- `App.jsx` — React frontend: upload UI + results table + PDF download link
- `requirements.txt` — Python dependencies
- `test_label.png` — a synthetic test label so you can verify the pipeline
  before testing with real product photos

## Fields checked (MVP scope — 5 core declarations)
1. MRP (Maximum Retail Price)
2. Net Quantity
3. Manufacturer Name/Address
4. Manufacturing Date
5. Consumer Care Details

These map to Rule 6(1) of the Legal Metrology (Packaged Commodities)
Rules, 2011. The rule patterns live in the `RULES` list in `main.py` —
add more dicts there to extend coverage without touching the checking logic.

## Setup

### Backend
```bash
# System dependency (if not already installed)
sudo apt-get install tesseract-ocr

# Python dependencies
pip install -r requirements.txt

# Run the server
uvicorn main:app --reload --port 8000
```
Visit `http://localhost:8000/docs` to test the `/scan` endpoint directly
via Swagger UI before wiring up the frontend.

### Frontend
Drop `App.jsx` into a React project (e.g. one created with `npm create vite@latest`):
```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
# replace src/App.jsx with the provided App.jsx
npm run dev
```
Make sure `API_BASE` in `App.jsx` matches wherever your backend is running.

## Known limitations (be upfront about these in Q&A)
- Regex-based field extraction is pattern-matched, not a true NLP/NER model —
  works well on standard label formats, may miss unusual phrasings.
- OCR accuracy depends heavily on image quality (lighting, angle, resolution).
  Test with real, well-lit product photos, not screenshots of text.
- Currently no PostgreSQL/persistence layer or auth — scan results are
  generated fresh each time and PDF reports are saved to `reports/`.
  These are natural "next steps" to mention in your presentation as
  planned extensions (matches the fuller architecture diagram).

## What to say if OCR misreads something in the live demo
This is normal — OCR on real-world curved/glared packaging is a known hard
problem. Have 2-3 pre-tested images ready that you know work well, and be
ready to explain your preprocessing approach (denoising + adaptive
thresholding) as the mitigation, with future work being deep-learning-based
OCR (EasyOCR/PaddleOCR) or a fine-tuned detector for label regions.
