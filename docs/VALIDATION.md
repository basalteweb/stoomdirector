# Validation de référence — Analysis Power 5.0 (base historique v4)

## Tests de build

- `python tests/test_public_context.py`
- `node tests/test_causal_context.js`
- `node --check js/*.js` et `sw.js`
- `python -m py_compile scripts/*.py`
- validation JSON de `data/public-context*.json`

## Régression TGM de référence

La base de test historique utilisée pendant le développement contient :

- 1 341 clients ;
- 15 446 lignes de vente ;
- 5 668 transactions ;
- 1 077 références catalogue ;
- 238 971,60 € TTC dans l’extraction Ventes.

Le moteur avait produit 5 454 transactions client certifiées, 157 probables et 57 anonymes, sans conflit d’identité, ainsi qu’une couverture catalogue de 15 180 lignes sur 15 446.

Ces chiffres servent de test de non-régression pour ces fichiers précis ; ils ne constituent pas des constantes du logiciel.

## Public context

Le collecteur v4 valide indépendamment chaque source. Le payload peut rester `partial` tout en étant exploitable. Une source absente ne doit jamais bloquer les calculs TGM.

## Geo render guard

Le rendu de Geo Intelligence est protégé par :

- séquence de rendu ;
- `requestAnimationFrame` ;
- bornage des zones affichées ;
- protections null/NaN ;
- capture d’exception par vue ;
- bouton de réessai.
