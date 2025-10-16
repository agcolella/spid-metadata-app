const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DIR_PATH = "/mnt/c/Users/coat/OneDrive - Agid/Desktop/metadata-notifier-master/data/inviati";        // <-- MODIFICA QUI
const BACKEND_URL = "http://localhost:4000/upload"; // <-- MODIFICA SE NECESSARIO

function getAllXmlFiles(dir, fileList=[]) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getAllXmlFiles(filePath, fileList);
    } else if (file.toLowerCase().endsWith('.xml')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

function chooseBestDate(stats) {
  // Preferisci birthtime solo se è plausibile (> 1980)
  if (stats.birthtime && stats.birthtime.getTime() > new Date('1980-01-01').getTime()) {
    return stats.birthtime.toISOString();
  } else if (stats.mtime) {
    return stats.mtime.toISOString();
  } else {
    return new Date().toISOString();
  }
}

async function sendFileWithCreationDate(filePath) {
  const stats = fs.statSync(filePath);
  const creationDate = chooseBestDate(stats);
  const fileData = fs.readFileSync(filePath);

  const FormData = require('form-data');
  const form = new FormData();
  form.append("xmlfile", fileData, path.basename(filePath));
  form.append("creationDate", creationDate);

  try {
    const response = await axios.post(BACKEND_URL, form, {
      headers: form.getHeaders()
    });
    return { 
      filename: filePath, 
      creationDate,
      birthtime: stats.birthtime.toISOString(),
      mtime: stats.mtime.toISOString(),
      status: "success", 
      message: response.data 
    };
  } catch (err) {
    return { 
      filename: filePath, 
      creationDate,
      birthtime: stats.birthtime.toISOString(),
      mtime: stats.mtime.toISOString(),
      status: "error", 
      message: err.response ? err.response.data : err.message 
    };
  }
}

async function batchUploadXmlFiles(dirPath) {
  const xmlFiles = getAllXmlFiles(dirPath);
  console.log(`Trovati ${xmlFiles.length} file XML. Inizio upload...\n`);
  const report = [];
  for (const filePath of xmlFiles) {
    const result = await sendFileWithCreationDate(filePath); 
    report.push(result);
    console.log(
      `[${result.status.toUpperCase()}]`,
      path.basename(filePath),
      `| Data usata: ${result.creationDate}`,
      `| birthtime: ${result.birthtime}`,
      `| mtime: ${result.mtime}`,
      result.status === "error" ? `| Errore: ${JSON.stringify(result.message)}` : "| OK"
    );
  }
  console.log("\n--- REPORT UPLOAD ---");
  report.forEach(r => {
    console.log(
      `[${r.status.toUpperCase()}]`,
      path.basename(r.filename),
      `| Data usata: ${r.creationDate}`,
      `| birthtime: ${r.birthtime}`,
      `| mtime: ${r.mtime}`,
      r.status === "error" ? `| Errore: ${JSON.stringify(r.message)}` : "| OK"
    );
  });
  console.log("Upload batch completato.");
}

// Esegui batch per la directory scelta
batchUploadXmlFiles(DIR_PATH);
