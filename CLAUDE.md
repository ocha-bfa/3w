# Présence opérationnelle 3W — Burkina Faso (OCHA)

Application web statique servie par GitHub Pages à `ocha-bfa.github.io/3w/` (dépôt github.com/ocha-bfa/3w ; ancienne adresse assefay.github.io/bfa-humanbase/3w/ redirigée ici),
données lues dans Supabase (projet bfa-humanbase, clé anon + RLS, PostgREST).
Même structure et mêmes conventions que `ocha-bfa/bilan` et `ocha-bfa/deplacements/` (feuilles A4 paysage = pages imprimées).

## Produit
- 5 vues : **National** (1 feuille), **Clusters** (1 feuille, 8 cartes communales), **Région** (1 feuille par région, sélecteur),
  **Organisation** (fiche ; liste déroulante des organisations de la période, ouverte par défaut sur la première par ordre alphabétique — jamais de fiche vide), **Répertoire** (liste par type, recherche, feuille haute).
  « Imprimer cette vue » = la vue affichée ; « Tout imprimer » = national + clusters + une feuille par région (ordre décroissant
  du nombre d'organisations) + répertoire. La fiche organisation n'est pas dans « Tout imprimer ».
- Filtres : période (bimestres présents en base, détectés automatiquement), région, organisation, recherche.
  L'état est dans l'URL (`#p=2026-3&vue=region&region=BF49&org=Plan`) : un lien reproduit une vue.
- Règle de comptage = celle du produit PDF : une organisation = un acronyme distinct, qu'elle soit organisation principale
  ou partenaire de mise en œuvre. Ne jamais additionner des périodes ni des régions (toujours des ensembles distincts).
  Contrôle : national 125 / 120 / 120 organisations (janv-fév / mars-avril / mai-juin 2026), identique à `v_3w_presence`.
- Feuille **Région** interactive (écran seulement) : cliquer une province (carte ou ligne du tableau) filtre la liste des organisations, les types et les petits chiffres sur cette province ; étiquette « Province : … ✕ » pour revenir à la région ; recliquer la province l'enlève aussi. Le total de la région reste affiché. Cliquer un nom d'organisation ouvre sa fiche. Cliquer une province sur la carte nationale ouvre sa région déjà filtrée. L'impression n'est jamais filtrée. État dans l'URL (`&prov=BF4901`).
- **Aucune comparaison entre périodes** (demande du 22/10/2026) : chaque feuille ne montre que la période choisie — pas de chiffre de la période précédente, pas d'écarts, pas de listes nouvelles/absentes, pas de barres ou de pastilles par période.
- **Niveau le plus fin affiché = province (admin2)** sur toutes les feuilles, y compris l'impression (demande du 22/10/2026) : aucune carte, liste ou compte par commune dans l'app.
- Cartes en SVG inline (`data/geo_bfa.js`, découpage 2025, même projection que bilan et déplacements). Classes de présence :
  provinces 0 / 1–5 / 6–10 / 11–20 / 21+ ; régions 1–5 / 6–20 / 21–40 / 41+ (bleus OCHA #BBD9F2 #64BDEA #0074B7 #1F4E79).
- Police Roboto / Roboto Condensed. Français, nombres fr-FR.

## Données (Supabase)
- Source : `partners_3w` (chargée par l'onglet « 3W Partenaires » de admin.html, un bimestre à la fois : suppression puis insertion).
  Colonnes nettoyées automatiquement à l'insertion par le déclencheur `partners_3w_clean_geo` (sql/01_nettoyage_geo.sql) :
  `region`, `province`, `commune`, `adm1_pcode`, `adm2_pcode`, `adm3_pcode` = noms et codes officiels 2025 ;
  `*_saisie` = valeurs du fichier source ; `niveau_geo` (commune / province / region) ; `methode_geo` (comment la commune
  a été trouvée) ; `communes_citees` ; `village` (colonne « Ville/village » du fichier) ; statut « Terminée » → « Terminé ».
- Résolution de la commune, dans l'ordre : nom de commune dans la province déclarée → orthographes connues
  (`w3_geo_alias`, `gcorr_commune_alias`) → nom dans la région → nom unique au pays → sinon déduite du **village**
  (table `villages`, 10 939 localités) : village unique dans la province puis dans la région ; plusieurs communes citées
  → niveau province + `communes_citees`. Résultat au 27/09/2026 : 100 % des lignes ont région et province ;
  commune connue pour 100 % (janv-fév), 92 % (mars-avril), 91 % (mai-juin) ; le reste = plusieurs communes citées ou aucune
  localité exploitable (« Secteur 1 », « Toutes les localités »).
- Nouvelle orthographe de commune ou de village non reconnue → ajouter une ligne dans `w3_geo_alias`
  (`niveau`='adm3', `nom_norm` = nom sans accents/espaces/ponctuation en minuscules, `pcode`), puis
  `update partners_3w set village = village where bimestre = '…'` pour renettoyer le bimestre. Jamais de correction dans l'app.
- Vues de l'app (sql/02_vues_app.sql) : `mv_3w_orgs` (référentiel matérialisé, indexé, rafraîchi par déclencheur — indispensable : sans lui la vue met 20 s et l'API répond HTTP 500), `v_3w_app` (période × organisation × cluster × zone, ≈ 3 500 lignes, chargée entière
  au démarrage), `v_3w_pairs` (organisation → partenaire de mise en œuvre, bailleurs), `v_3w_orgs` (référentiel).
  Type d'organisation = `org_reference.type_organisation` canonisé en 6 catégories (ONG nationale, ONG internationale,
  Nations Unies, Gouvernement, Consortium, Mouvement Croix-Rouge), complété par `org_type` (feuille QUI du fichier).
- Acronymes canonisés par clé sans accents/ponctuation (APIJ/CN = APIJ-CN, Todi yaba = TODIYABA) : une seule entité.

## Structure du dossier
index.html · app.js · style.css · data/geo_bfa.js (copie de ocha-bfa/deplacements/data/geo_bfa.js) · sql/*.sql

## Façon de travailler
- Petites étapes, une feuille ou un bloc à la fois ; montrer le résultat (capture Playwright) avant de passer au suivant.
- Vérifier chaque chiffre contre `v_3w_presence` (national et par région) et contre le produit PDF du bimestre.
- Nettoyage des données : toujours en base (déclencheur, alias), jamais dans l'app.
