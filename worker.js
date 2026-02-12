/* global importScripts, PDFLib */

// @ts-ignore
importScripts('https://unpkg.com/pdf-lib/dist/pdf-lib.min.js');

/** @param {MessageEvent} e */
onmessage = async function(e) {
    const { action, filesData } = e.data;
    
    // We access PDFLib from the global scope after importScripts
    // @ts-ignore
    const { PDFDocument } = PDFLib;

    try {
        if (action === 'merge') {
            const mergedPdf = await PDFDocument.create();
            
            for (let i = 0; i < filesData.length; i++) {
                const pdf = await PDFDocument.load(filesData[i]);
                const indices = pdf.getPageIndices();
                const copiedPages = await mergedPdf.copyPages(pdf, indices);
                
                // Use a standard for-loop to avoid arrow function scope issues
                for (const page of copiedPages) {
                    mergedPdf.addPage(page);
                }
                
                postMessage({ type: 'progress', value: ((i + 1) / filesData.length) * 100 });
            }
            
            const mergedBytes = await mergedPdf.save();
            postMessage({ type: 'done', data: mergedBytes, filename: "merged.pdf" }, [mergedBytes.buffer]);

        } else if (action === 'split') {
            const mainPdf = await PDFDocument.load(filesData[0]);
            const pageCount = mainPdf.getPageCount();

            for (let i = 0; i < pageCount; i++) {
                const newPdf = await PDFDocument.create();
                // Copy pages one by one
                const copiedPages = await newPdf.copyPages(mainPdf, [i]);
                newPdf.addPage(copiedPages[0]);
                
                const pageBytes = await newPdf.save();
                
                postMessage({ 
                    type: i === pageCount - 1 ? 'done' : 'page', 
                    data: pageBytes, 
                    filename: `page_${i + 1}.pdf`,
                    value: ((i + 1) / pageCount) * 100 
                }, [pageBytes.buffer]);
            }
        }
    } catch (err) {
        postMessage({ type: 'error', message: err.message });
    }
};