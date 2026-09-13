import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSaplMateria} from '../supabase/functions/radar-coletor/sapl.mjs';
const page='<h1>Requerimento nº 36 de 2026</h1><div id="div_id_ementa"><div class="form-control-static"><div>Requer informações sobre o orçamento da cultura.</div></div></div><div id="div_id_data_apresentacao"><div class="form-control-static">10/09/2026</div></div>';
test('SAPL lê ementa e apresentação sem inventar data de documento ou execução',()=>{
 const x=extractSaplMateria(page,'https://sapl.saogoncalodoamarante.ce.leg.br/materia/4587');
 assert.match(x.title,/Requer informações/);assert.equal(x.date,null);assert.equal(x.sourceDate,'2026-09-10');assert.match(x.evidence,/não comprova sua aprovação/);
});
test('SAPL rejeita outra cidade e mudança de estrutura',()=>{
 assert.throws(()=>extractSaplMateria(page,'https://outro.example/materia/4587'));
 assert.throws(()=>extractSaplMateria('<h1>Erro</h1>','https://sapl.saogoncalodoamarante.ce.leg.br/materia/4587'));
});
