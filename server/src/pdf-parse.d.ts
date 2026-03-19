// Re-export types from @types/pdf-parse for the direct lib import path
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdfParse from 'pdf-parse';
  export default pdfParse;
}
