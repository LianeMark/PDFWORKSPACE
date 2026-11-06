importScripts('https://unpkg.com/pdf-lib/dist/pdf-lib.min.js');
importScripts('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');

onmessage = async function(e) {
    const { action, filesData, targetPages } = e.data;
    const { PDFDocument, StandardFonts } = PDFLib;

    try {
        if (action === 'get-pages') {
            const pdf = await PDFDocument.load(filesData[0]);
            for (let i = 0; i < pdf.getPageCount(); i++) {
                const newPdf = await PDFDocument.create();
                const [p] = await newPdf.copyPages(pdf, [i]);
                newPdf.addPage(p);
                const bytes = await newPdf.save();
                postMessage({ type: 'page-preview', data: bytes, index: i }, [bytes.buffer]);
            }
        } 
        else if (action === 'merge' || action === 'merge-selective') {
            const mergedPdf = await PDFDocument.create();
            if (action === 'merge-selective') {
                const pdf = await PDFDocument.load(filesData[0]);
                const copied = await mergedPdf.copyPages(pdf, targetPages);
                copied.forEach((p, i) => {
                    mergedPdf.addPage(p);
                    postMessage({ type: 'progress', value: ((i + 1) / copied.length) * 100 });
                });
            } else {
                for (let i = 0; i < filesData.length; i++) {
                    const pdf = await PDFDocument.load(filesData[i]);
                    const copied = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                    copied.forEach(p => mergedPdf.addPage(p));
                    postMessage({ type: 'progress', value: ((i + 1) / filesData.length) * 100 });
                }
            }
            const bytes = await mergedPdf.save();
            postMessage({ type: 'done', data: bytes, filename: "merged_output.pdf" }, [bytes.buffer]);
        }
        else if (action === 'split') {
            const pdf = await PDFDocument.load(filesData[0]);
            const indices = targetPages.length > 0 ? targetPages : pdf.getPageIndices();
            for (let i = 0; i < indices.length; i++) {
                const newPdf = await PDFDocument.create();
                const [p] = await newPdf.copyPages(pdf, [indices[i]]);
                newPdf.addPage(p);
                const bytes = await newPdf.save();
                postMessage({ type: 'page', data: bytes, filename: `page_${indices[i] + 1}.pdf` });
                postMessage({ type: 'progress', value: ((i + 1) / indices.length) * 100 });
            }
            postMessage({ type: 'done' });
        }
        else if (action === 'ocr') {
            // Unpack the variables sent from the main thread
            const { imagesData, filesData, targetPages, scale } = e.data;
            let currentIndex = 0;
            
            // 1. Wake up the Tesseract engine
            const tessWorker = await Tesseract.createWorker('eng', 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const baseProgress = (currentIndex / imagesData.length) * 100;
                        const currentProgress = (m.progress / imagesData.length) * 100;
                        postMessage({ type: 'progress', value: baseProgress + currentProgress });
                    }
                }
            });

            // 2. Load the ORIGINAL visual PDF to guarantee it doesn't turn white
            const originalPdf = await PDFDocument.load(filesData[0]);
            const font = await originalPdf.embedFont(StandardFonts.Helvetica);

            // 3. Process each page image and map the text
            for (let i = 0; i < imagesData.length; i++) {
                currentIndex = i;
                const pageIndex = targetPages[i];
                const page = originalPdf.getPage(pageIndex);
                const { height: pageHeight } = page.getSize();
                
                // Have Tesseract read the image and give us the word coordinates
                const { data } = await tessWorker.recognize(imagesData[i]);
                
                if (data && data.words) {
                    for (const word of data.words) {
                        // Translate Tesseract coordinates to PDF-lib coordinates
                        const x = word.bbox.x0 / scale;
                        const y0 = word.bbox.y0 / scale;
                        const y1 = word.bbox.y1 / scale;
                        const wordHeight = y1 - y0;
                        const pdfY = pageHeight - y1; // PDF origin is bottom-left, Tesseract is top-left

                        try {
                            // Draw invisible text over the image (hidden but selectable)
                            page.drawText(word.text, {
                                x: x,
                                y: pdfY,
                                size: wordHeight,
                                font: font,
                                opacity: 0,
                            });
                        } catch (err) {
                            // Ignore weird characters that pdf-lib might not like
                        }
                    }
                }
            }
            
            await tessWorker.terminate();
            
            // 4. Save and return the updated original document
            const finalBytes = await originalPdf.save();
            postMessage({ type: 'done', data: finalBytes, filename: "Searchable_OCR_Document.pdf" });
        }
        else if (action === 'img2pdf') {
            const { images, pageSize, margin } = e.data;
            const pdf = await PDFDocument.create();
            const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

            for (let i = 0; i < images.length; i++) {
                const item = images[i];
                const img = item.type === 'jpg'
                    ? await pdf.embedJpg(item.data)
                    : await pdf.embedPng(item.data);

                if (pageSize === 'fit') {
                    const page = pdf.addPage([img.width, img.height]);
                    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
                } else {
                    let [pw, ph] = SIZES[pageSize];
                    if (img.width > img.height) [pw, ph] = [ph, pw]; // landscape images get landscape pages
                    const page = pdf.addPage([pw, ph]);

                    const m = Math.min(margin, Math.min(pw, ph) / 4);
                    const scale = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
                    const dw = img.width * scale;
                    const dh = img.height * scale;
                    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
                }
                postMessage({ type: 'progress', value: ((i + 1) / images.length) * 100 });
            }

            const bytes = await pdf.save();
            postMessage({ type: 'done', data: bytes, filename: "images_output.pdf" }, [bytes.buffer]);
        }
        else if (action === 'compress-light') {
            // Lossless: copy pages into a fresh document (drops unused/orphaned objects)
            // and save with compressed object streams.
            const src = await PDFDocument.load(filesData[0], { updateMetadata: false });
            const out = await PDFDocument.create();
            const copied = await out.copyPages(src, src.getPageIndices());
            copied.forEach((p, i) => {
                out.addPage(p);
                postMessage({ type: 'progress', value: ((i + 1) / copied.length) * 90 });
            });
            const bytes = await out.save({ useObjectStreams: true });
            postMessage({ type: 'progress', value: 100 });
            postMessage({ type: 'done', data: bytes, filename: "compressed_light.pdf" }, [bytes.buffer]);
        }
        else if (action === 'compress-strong') {
            // Rebuild the PDF from pre-rendered JPEG pages (rendered on the main thread).
            // Each page keeps its original size in PDF points.
            const { pages } = e.data;
            const out = await PDFDocument.create();

            for (let i = 0; i < pages.length; i++) {
                const p = pages[i];
                const img = await out.embedJpg(p.data);
                const page = out.addPage([p.width, p.height]);
                page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
                // The main thread already used the first 70% for rendering
                postMessage({ type: 'progress', value: 70 + ((i + 1) / pages.length) * 30 });
            }

            const bytes = await out.save({ useObjectStreams: true });
            postMessage({ type: 'done', data: bytes, filename: "compressed_output.pdf" }, [bytes.buffer]);
        }
    } catch (err) { 
        postMessage({ type: 'error', msg: err.message }); 
    }
};
