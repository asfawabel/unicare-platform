import {cpSync, mkdirSync, writeFileSync} from 'node:fs';
mkdirSync('dist/learn', {recursive:true});
cpSync('apps/site/dist', 'dist', {recursive:true});
cpSync('apps/learn/dist', 'dist/learn', {recursive:true});
writeFileSync('dist/.nojekyll', '');
console.log('Prepared dist/ (website at / and EduCare at /learn/)');
