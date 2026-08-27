"""
Legal Metrology Compliance Checker — MVP Backend
FastAPI + OpenCV + Tesseract OCR + Rule Engine + ReportLab

Run: uvicorn main:app --reload --port 8000
Test: open http://localhost:8000/docs and try POST /scan
"""

import io
import re
import uuid
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

app = FastAPI(title="Legal Metrology Compliance Checker - MVP")

# Allow the React frontend (running on a different port) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REPORTS_DIR = Path("reports")
REPORTS_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# STEP 1: Image preprocessing (OpenCV)
# ---------------------------------------------------------------------------
def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """Convert uploaded bytes -> grayscale, denoised, thresholded image for better OCR."""
    npimg = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, h=15)
    # Adaptive threshold handles uneven lighting on product labels better than a global one
    thresh = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    return thresh


# ---------------------------------------------------------------------------
# STEP 2: OCR (Tesseract)
# ---------------------------------------------------------------------------
def run_ocr(processed_img: np.ndarray) -> str:
    text = pytesseract.image_to_string(processed_img)
    return text


# ---------------------------------------------------------------------------
# STEP 3: Rule Engine — Legal Metrology (Packaged Commodities) Rules, 2011
# Checks for the 5 core mandatory declarations. Each rule is a dict so it's
# easy to extend without touching the checking logic (data-driven rules).
# ---------------------------------------------------------------------------
RULES = [
    {
        "field": "MRP (Maximum Retail Price)",
        "pattern": r"(?:MRP|M\.R\.P|Maximum\s*Retail\s*Price)[^\d\n]*?([\d,]*\d[\d,]*\.?\d*)",
        "clause": "Rule 6(1)(f) — Retail sale price must be declared, inclusive of all taxes",
    },
    {
        "field": "Net Quantity",
        "pattern": r"(?:Net\s*(?:Wt\.?|Weight|Qty\.?|Quantity|Wt|w)?|Netw|N\.\s*Qty\.?|Qty\.?|Non\.?[\s.:]+Qty\.?|Non\.?[\s.:]+QTY\.?|Non\.?)[^\w\n]*?([\d.]+\s?(?:g|kg|ml|l|litre|gram|gm|gms|kgs|ml\.?|ltr|ltrs|9|5)?s?\b)",
        "clause": "Rule 6(1)(b) — Net quantity in standard units must be declared",
    },
    {
        "field": "Manufacturer Name/Address",
        "pattern": r"(?:Mfg\.?\s*by|Mfd\.?\s*by|Manufactured\s*(?:by|Name)?|Manufacturer|Marketed\.?\s*(?:by)?|Packer\s*(?:by)?|Packed\s*(?:by)?|Importer\s*(?:by)?|Imported\s*(?:by)?)[\s,.:]*([A-Za-z0-9,.\s-]{5,100})",
        "clause": "Rule 6(1)(a) — Name and address of manufacturer/packer/importer",
    },
    {
        "field": "Manufacturing Date",
        "pattern": r"(?:Mfg\.?\s*Date|Manufactured\s*(?:on|date)?|Date\s*of\s*Mfg|Mfg\s*Month/Year|Mfg\s*Dt|Packing\s*Date|Packed\s*on)[^\d\n]*?(\d{1,2}[/\-.]\d{1,4}|\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-zA-Z]*[/\-.\s]*\d{2,4})",
        "clause": "Rule 6(1)(e) — Month and year of manufacture must be declared",
    },
    {
        "field": "Consumer Care Details",
        "pattern": r"(?:Consumer\s*Care|Customer\s*Care|Toll\s*Free|Care\s*No|Helpline|Consumer\s*Cell|Consumer\s*Services(?:\s*Manager)?|Feedback\s*or\s*Queries|Call\s*?Us\s*?At|Email\s*?Us\s*?At)[^\w]*?([A-Za-z0-9@.,\s\-\+\(\)]{5,150})",
        "clause": "Rule 6(1)(d) — Name, address, telephone/email of consumer care",
    },
]


def check_compliance(text: str) -> list[dict]:
    results = []
    for rule in RULES:
        match = re.search(rule["pattern"], text, re.IGNORECASE)
        if match:
            extracted_value = match.group(1).strip() if match.group(1) else ""
            field = rule["field"]
            
            # Post-extraction content verification
            has_letters = re.search(r'[A-Za-z]', extracted_value)
            has_digits = re.search(r'\d', extracted_value)
            
            status = "PASS"
            format_status = "COMPLIANT"
            reason = None
            
            if field == "MRP (Maximum Retail Price)":
                if not has_digits:
                    status = "MISSING"
                    format_status = "NON_COMPLIANT"
                    reason = "MRP value is missing (Rule 6(1)(f))"
                else:
                    match_start = match.start()
                    context = text[max(0, match_start - 30):min(len(text), match_start + 120)].lower()
                    
                    has_tax = "incl" in context or "tax" in context or "inclusive" in context
                    has_currency = any(symbol in match.group(0).lower() for symbol in ["rs", "rupee", "₹", "r5", "re", "ps", "fs", "rp", "inr"])
                    
                    if not has_tax:
                        format_status = "INCORRECT_FORMAT"
                        reason = "Missing 'inclusive of all taxes' declaration (Rule 6(1)(f))"
                    elif not has_currency:
                        format_status = "INCORRECT_FORMAT"
                        reason = "Missing/unrecognized currency symbol (Rule 6(1)(f))"
                        
            elif field == "Net Quantity":
                if not has_digits:
                    status = "MISSING"
                    format_status = "NON_COMPLIANT"
                    reason = "Net Quantity value is missing (Rule 6(1)(b))"
                else:
                    qty_match = re.match(r'^([\d.]+)\s*([a-zA-Z]+)$', extracted_value)
                    misread_match = re.match(r'^(\d+)\s*([95])$', extracted_value)
                    
                    if qty_match:
                        unit = qty_match.group(2).lower()
                        
                        standard_units = ["g", "kg", "ml", "l", "litre", "litres", "grams", "gram"]
                        non_standard_units = ["gm", "gms", "grm", "kgs", "ltr", "ltrs", "ml."]
                        
                        if unit in non_standard_units:
                            format_status = "INCORRECT_FORMAT"
                            reason = f"Non-standard unit '{qty_match.group(2)}'. Use standard symbol (g, kg, ml, l)"
                        elif unit not in standard_units:
                            format_status = "INCORRECT_FORMAT"
                            reason = f"Unrecognized unit '{qty_match.group(2)}'"
                    elif misread_match:
                        # Recover common OCR digit misreads of standard units (like 9 or 5 instead of g)
                        format_status = "INCORRECT_FORMAT"
                        reason = f"Quantity unit misread as '{misread_match.group(2)}' by OCR. Expected standard symbol (g)"
                        extracted_value = f"{misread_match.group(1)} g"
                    else:
                        format_status = "INCORRECT_FORMAT"
                        reason = "Quantity format should be a number followed by a unit (e.g. '250 g')"
                        
            elif field == "Manufacturer Name/Address":
                # Ensure it contains actual letters of name/address text
                if not has_letters or len(extracted_value) < 15:
                    status = "MISSING"
                    format_status = "NON_COMPLIANT"
                    reason = "Manufacturer details are missing or incomplete (Rule 6(1)(a))"
                else:
                    has_location = any(ind in extracted_value.lower() for ind in [
                        "karnataka", "maharashtra", "delhi", "mumbai", "bengaluru", "bangalore", "chennai", "kolkata",
                        "road", "street", "ind", "pvt", "ltd", "corp", "inc"
                    ]) or re.search(r'\b\d{6}\b', extracted_value)
                    
                    if not has_location:
                        format_status = "INCORRECT_FORMAT"
                        reason = "Manufacturer address lacks city, state, or PIN code (Rule 6(1)(a))"
                        
            elif field == "Manufacturing Date":
                if not has_digits:
                    status = "MISSING"
                    format_status = "NON_COMPLIANT"
                    reason = "Manufacturing Date value is missing (Rule 6(1)(e))"
                else:
                    is_valid = False
                    if re.match(r'^(0[1-9]|1[0-2])[/\-.](20\d{2}|\d{2})$', extracted_value):
                        is_valid = True
                    elif re.match(r'^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-zA-Z]*[/\-.\s]*(?:20)?\d{2}$', extracted_value, re.IGNORECASE):
                        is_valid = True
                    
                    if not is_valid:
                        format_status = "INCORRECT_FORMAT"
                        reason = "Date must be MM/YYYY or Month YYYY format (Rule 6(1)(e))"
                        
            elif field == "Consumer Care Details":
                has_phone = re.search(r'\b\d{3,5}[-\s]?\d{3,5}[-\s]?\d{3,5}\b', extracted_value) or re.search(r'\d{8,11}', extracted_value)
                has_email = "@" in extracted_value and "." in extracted_value
                
                match_start = match.start()
                context = text[max(0, match_start - 30):min(len(text), match_start + 180)].lower()
                
                has_phone_context = has_phone or "phone" in context or "tel" in context or "call" in context or "no" in context or "care" in context
                has_email_context = has_email or "email" in context or "mail" in context or re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
                
                if not (has_phone_context or has_email_context):
                    format_status = "INCORRECT_FORMAT"
                    reason = "Missing phone number and email address (Rule 6(1)(d))"
                elif not has_phone_context:
                    format_status = "INCORRECT_FORMAT"
                    reason = "Missing consumer care contact number (Rule 6(1)(d))"
                elif not has_email_context:
                    format_status = "INCORRECT_FORMAT"
                    reason = "Missing consumer care email address (Rule 6(1)(d))"

            results.append({
                "field": field,
                "status": status,
                "format_status": format_status,
                "extracted_value": extracted_value if status == "PASS" else None,
                "reason": reason,
                "clause": rule["clause"],
            })
        else:
            results.append({
                "field": rule["field"],
                "status": "MISSING",
                "format_status": "NON_COMPLIANT",
                "extracted_value": None,
                "reason": "Field not found on label",
                "clause": rule["clause"],
            })
    return results


# ---------------------------------------------------------------------------
# STEP 4: PDF Report generation (ReportLab)
# ---------------------------------------------------------------------------
def generate_pdf_report(scan_id: str, results: list[dict], raw_text: str) -> Path:
    filepath = REPORTS_DIR / f"report_{scan_id}.pdf"
    doc = SimpleDocTemplate(str(filepath), pagesize=A4)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("Legal Metrology Compliance Checker Report", styles["Title"]))
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"Scan ID: {scan_id}", styles["Normal"]))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", styles["Normal"]))
    story.append(Spacer(1, 16))

    compliant_count = sum(1 for r in results if r["status"] == "PASS" and r["format_status"] == "COMPLIANT")
    total = len(results)
    
    if compliant_count == total:
        verdict = "COMPLIANT"
    else:
        verdict = f"NON-COMPLIANT ({total - compliant_count} issue(s) detected)"
        
    story.append(Paragraph(f"<b>Overall Verdict: {verdict}</b>", styles["Heading2"]))
    story.append(Spacer(1, 12))

    table_data = [["Field", "Status", "Extracted Value", "Compliance Details", "Relevant Clause"]]
    for r in results:
        status_text = r["status"]
        if r["status"] == "PASS" and r["format_status"] == "INCORRECT_FORMAT":
            status_text = "INCORRECT FORMAT"
            
        table_data.append([
            r["field"],
            status_text,
            r["extracted_value"] or "-",
            r["reason"] or "Compliant",
            r["clause"],
        ])

    table = Table(table_data, colWidths=[95, 75, 95, 110, 125])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    
    for i, r in enumerate(results, start=1):
        if r["status"] == "PASS":
            if r["format_status"] == "COMPLIANT":
                color = colors.HexColor("#d4edda")
            else:
                color = colors.HexColor("#fff3cd")
        else:
            color = colors.HexColor("#f8d7da")
        table.setStyle(TableStyle([("BACKGROUND", (1, i), (1, i), color)]))

    story.append(table)
    story.append(Spacer(1, 16))
    story.append(Paragraph("Raw OCR Extracted Text", styles["Heading3"]))
    story.append(Paragraph(raw_text.replace("\n", "<br/>") or "(no text detected)", styles["Code"]))

    doc.build(story)
    return filepath


# ---------------------------------------------------------------------------
# API Endpoint
# ---------------------------------------------------------------------------
@app.post("/scan")
async def scan_label(file: UploadFile = File(...)):
    image_bytes = await file.read()
    scan_id = str(uuid.uuid4())[:8]

    # Decode raw image
    npimg = np.frombuffer(image_bytes, np.uint8)
    raw_img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    if raw_img is None:
        return {"error": "Failed to decode image"}
        
    # 1. Upscale image to ensure text details are large enough for Tesseract
    h, w = raw_img.shape[:2]
    if w < 1800:
        scale_factor = 1800 / w
        img_scaled = cv2.resize(raw_img, (1800, int(h * scale_factor)), interpolation=cv2.INTER_CUBIC)
    else:
        img_scaled = raw_img
        
    # Pass 1: Try OCR on raw/scaled image
    raw_text = pytesseract.image_to_string(img_scaled)
    raw_results = check_compliance(raw_text)
    
    # Grayscale conversion and bilateral filtering for threshold passes
    gray = cv2.cvtColor(img_scaled, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, 9, 75, 75)
    
    # Pass 2: Try OCR on Otsu thresholding
    _, otsu_img = cv2.threshold(filtered, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    otsu_text = pytesseract.image_to_string(otsu_img)
    otsu_results = check_compliance(otsu_text)
    
    # Pass 3: Try OCR on Adaptive thresholding
    adaptive_img = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    adaptive_text = pytesseract.image_to_string(adaptive_img)
    adaptive_results = check_compliance(adaptive_text)
    
    # Heuristic: Combine results of all passes using a Priority Union Resolution.
    # We rank each field result:
    #   Rank 2: PASS and COMPLIANT
    #   Rank 1: PASS and INCORRECT_FORMAT
    #   Rank 0: MISSING
    final_results = []
    
    # Get all check fields
    fields = [rule["field"] for rule in RULES]
    
    # Map raw_results, otsu_results, and adaptive_results by field name
    raw_map = {r["field"]: r for r in raw_results}
    otsu_map = {r["field"]: r for r in otsu_results}
    adap_map = {r["field"]: r for r in adaptive_results}
    
    def get_rank(result_item):
        if result_item["status"] == "PASS":
            if result_item["format_status"] == "COMPLIANT":
                return 2
            else:
                return 1
        return 0
        
    for field in fields:
        r1 = raw_map[field]
        r2 = otsu_map[field]
        r3 = adap_map[field]
        
        # Select result with highest rank
        selected = r1
        max_rank = get_rank(r1)
        
        if get_rank(r2) > max_rank:
            selected = r2
            max_rank = get_rank(r2)
            
        if get_rank(r3) > max_rank:
            selected = r3
            max_rank = get_rank(r3)
            
        final_results.append(selected)
        
    final_text = f"--- PASS 1 (RAW SCALED) ---\n{raw_text}\n\n--- PASS 2 (OTSU BINARY) ---\n{otsu_text}\n\n--- PASS 3 (ADAPTIVE THRESHOLD) ---\n{adaptive_text}"
    
    pdf_path = generate_pdf_report(scan_id, final_results, final_text)

    compliant_count = sum(1 for r in final_results if r["status"] == "PASS" and r["format_status"] == "COMPLIANT")
    return {
        "scan_id": scan_id,
        "verdict": "COMPLIANT" if compliant_count == len(final_results) else "NON-COMPLIANT",
        "fields_checked": len(final_results),
        "fields_passed": compliant_count,
        "results": final_results,
        "raw_text": final_text,
        "report_url": f"/report/{scan_id}",
    }


@app.get("/report/{scan_id}")
async def get_report(scan_id: str):
    filepath = REPORTS_DIR / f"report_{scan_id}.pdf"
    return FileResponse(filepath, media_type="application/pdf", filename=f"compliance_report_{scan_id}.pdf")


@app.get("/")
async def root():
    return {"status": "ok", "message": "Legal Metrology Compliance Checker API is running"}
