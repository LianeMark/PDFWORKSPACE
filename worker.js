importScripts('https://unpkg.com/pdf-lib/dist/pdf-lib.min.js');

onmessage = async function(e) {
    const { action, filesData, targetPages } = e.data;
    const { PDFDocument } = PDFLib;

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
    } catch (err) { postMessage({ type: 'error', msg: err.message }); }
};
