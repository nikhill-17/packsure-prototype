FROM python:3.11-slim

# Install system dependencies for Tesseract OCR and OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY main.py .
RUN mkdir -p reports

# Expose port (Render overrides this dynamically via the PORT environment variable)
EXPOSE 8000

# Run FastAPI app dynamically binding to Render's custom port
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
