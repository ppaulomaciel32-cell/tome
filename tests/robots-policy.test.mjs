import test from 'node:test';
import assert from 'node:assert/strict';
import {robotsPolicy} from '../supabase/functions/radar-coletor/robots.mjs';
test('respeita intervalo da Câmara e proibição de anexos, permitindo fichas',()=>{
 const p=robotsPolicy('User-agent: OtherBot\nDisallow: /\nUser-agent: *\nCrawl-delay: 60\nDisallow: /materia/docacessorio/pdf/*');
 assert.equal(p.delay,60);assert.equal(p.allowed('https://sapl.example/materia/4587'),true);assert.equal(p.allowed('https://sapl.example/materia/docacessorio/pdf/1'),false);
});
test('grupo específico, wildcard e allow mais específico têm precedência',()=>{
 const p=robotsPolicy('User-agent: *\nDisallow: /\nUser-agent: RadarTomeNota\nUser-agent: OutraMarca\nDisallow: /privado/*\nAllow: /privado/publico$');
 assert.equal(p.allowed('https://teste.invalid/'),true);assert.equal(p.allowed('https://teste.invalid/privado/x'),false);assert.equal(p.allowed('https://teste.invalid/privado/publico'),true);
});
