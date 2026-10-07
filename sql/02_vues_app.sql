-- Vues lues par l'application 3w (clé anon, lecture seule). Appliquées à Supabase le 27/09/2026.
-- mv_3w_orgs : référentiel des organisations matérialisé et indexé (org_reference + org_type), rafraîchi
--   automatiquement par déclencheur quand org_reference ou org_type change. Sans lui, v_3w_app mettait 20 s (HTTP 500 via l'API).
-- v_3w_app : une ligne par période × organisation × cluster × zone ; org = organisation principale OU partenaire de mise en œuvre.
-- v_3w_pairs : couples organisation → partenaire de mise en œuvre, avec bailleurs (fiche organisation).

CREATE OR REPLACE FUNCTION public.f_3w_type_canon(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when lower(coalesce(t,'')) like '%internationale%' then 'ONG internationale'
    when lower(coalesce(t,'')) like '%nationale%' then 'ONG nationale'
    when lower(coalesce(t,'')) like '%nations unies%' or lower(coalesce(t,'')) like '%agence%' or lower(coalesce(t,'')) = 'un' then 'Nations Unies'
    when lower(coalesce(t,'')) like 'gouvern%' then 'Gouvernement'
    when lower(coalesce(t,'')) like '%consortium%' then 'Consortium'
    when lower(coalesce(t,'')) like '%croix%' or lower(coalesce(t,'')) like '%mcr%' then 'Mouvement Croix-Rouge'
    when t is null or t = '' then null else 'Autre' end $function$;

CREATE OR REPLACE FUNCTION public.f_org_key(s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select lower(regexp_replace(public.unaccent(trim(coalesce(s,''))),'[^a-zA-Z0-9]','','g')) $function$;

create materialized view public.mv_3w_orgs as  WITH r AS (
         SELECT f_org_key(org_reference.acronym) AS org_key,
            org_reference.acronym,
            org_reference.nom_complet,
            f_3w_type_canon(org_reference.type_organisation) AS type_org,
            row_number() OVER (PARTITION BY (f_org_key(org_reference.acronym)) ORDER BY (length(org_reference.acronym)), org_reference.acronym) AS rn
           FROM org_reference
        ), r1 AS (
         SELECT r.org_key,
            r.acronym,
            r.nom_complet,
            r.type_org,
            r.rn
           FROM r
          WHERE (r.rn = 1)
        ), t AS (
         SELECT f_org_key(org_type.org_key) AS org_key,
            min(org_type.org_name) AS org_name,
            f_3w_type_canon(min(org_type.type_organisation)) AS type_org
           FROM org_type
          GROUP BY (f_org_key(org_type.org_key))
        )
 SELECT COALESCE(r1.org_key, t.org_key) AS org_key,
    COALESCE(r1.acronym, t.org_name) AS acronym,
    r1.nom_complet,
    COALESCE(r1.type_org, t.type_org) AS type_org
   FROM (r1
     FULL JOIN t ON ((t.org_key = r1.org_key)));
create unique index mv_3w_orgs_key on public.mv_3w_orgs (org_key);

CREATE OR REPLACE FUNCTION public.trg_refresh_mv_3w_orgs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin refresh materialized view public.mv_3w_orgs; return null; end $function$;

create or replace view public.v_3w_orgs as  SELECT org_key,
    acronym,
    nom_complet,
    type_org
   FROM mv_3w_orgs;

create or replace view public.v_3w_app as  WITH parts AS (
         SELECT p.id,
            p.annee,
            p.bimestre,
            p.cluster_code,
            p.adm1_pcode,
            p.adm2_pcode,
            p.adm3_pcode,
            p.niveau_geo,
            p.personnes,
            x.role,
            TRIM(BOTH FROM x.org) AS org_brut,
            f_org_key(x.org) AS org_key,
            cc.cc
           FROM ((partners_3w p
             CROSS JOIN LATERAL ( VALUES ('org'::text,p.organisation), ('moe'::text,p.partenaire_moe)) x(role, org))
             LEFT JOIN LATERAL unnest(p.communes_citees) cc(cc) ON (true))
          WHERE (COALESCE(TRIM(BOTH FROM x.org), ''::text) <> ''::text)
        )
 SELECT c.annee,
    c.bimestre,
        CASE c.bimestre
            WHEN 'janvier-février'::text THEN 1
            WHEN 'mars-avril'::text THEN 2
            WHEN 'mai-juin'::text THEN 3
            WHEN 'juillet-août'::text THEN 4
            WHEN 'septembre-octobre'::text THEN 5
            WHEN 'novembre-décembre'::text THEN 6
            ELSE NULL::integer
        END AS bimestre_ordre,
    COALESCE(o.acronym, c.org_brut) AS org,
    c.org_key,
    COALESCE(o.type_org, 'Non renseigné'::text) AS type_org,
    o.nom_complet,
    c.cluster_code,
    c.adm1_pcode,
    c.adm2_pcode,
    c.adm3_pcode,
    c.niveau_geo,
    bool_or((c.role = 'org'::text)) AS principal,
    bool_or((c.role = 'moe'::text)) AS mise_en_oeuvre,
    count(DISTINCT c.id) AS activites,
    ( SELECT sum(q.personnes) AS sum
           FROM partners_3w q
          WHERE (q.id = ANY (array_agg(DISTINCT c.id)))) AS personnes,
    array_remove(array_agg(DISTINCT c.cc), NULL::text) AS communes_citees
   FROM (parts c
     LEFT JOIN mv_3w_orgs o ON ((o.org_key = c.org_key)))
  GROUP BY c.annee, c.bimestre, c.org_key, COALESCE(o.acronym, c.org_brut), COALESCE(o.type_org, 'Non renseigné'::text), o.nom_complet, c.cluster_code, c.adm1_pcode, c.adm2_pcode, c.adm3_pcode, c.niveau_geo;

create or replace view public.v_3w_pairs as  SELECT p.annee,
        CASE p.bimestre
            WHEN 'janvier-février'::text THEN 1
            WHEN 'mars-avril'::text THEN 2
            WHEN 'mai-juin'::text THEN 3
            WHEN 'juillet-août'::text THEN 4
            WHEN 'septembre-octobre'::text THEN 5
            WHEN 'novembre-décembre'::text THEN 6
            ELSE NULL::integer
        END AS bimestre_ordre,
    COALESCE(ko.acronym, TRIM(BOTH FROM p.organisation)) AS organisation,
    COALESCE(km.acronym, NULLIF(TRIM(BOTH FROM p.partenaire_moe), ''::text)) AS partenaire_moe,
    p.cluster_code,
    string_agg(DISTINCT NULLIF(TRIM(BOTH FROM p.bailleur), ''::text), ' | '::text) AS bailleur,
    count(*) AS activites
   FROM ((partners_3w p
     LEFT JOIN mv_3w_orgs ko ON ((ko.org_key = f_org_key(p.organisation))))
     LEFT JOIN mv_3w_orgs km ON ((km.org_key = f_org_key(p.partenaire_moe))))
  GROUP BY p.annee,
        CASE p.bimestre
            WHEN 'janvier-février'::text THEN 1
            WHEN 'mars-avril'::text THEN 2
            WHEN 'mai-juin'::text THEN 3
            WHEN 'juillet-août'::text THEN 4
            WHEN 'septembre-octobre'::text THEN 5
            WHEN 'novembre-décembre'::text THEN 6
            ELSE NULL::integer
        END, COALESCE(ko.acronym, TRIM(BOTH FROM p.organisation)), COALESCE(km.acronym, NULLIF(TRIM(BOTH FROM p.partenaire_moe), ''::text)), p.cluster_code;;

drop trigger if exists org_reference_refresh_mv on public.org_reference;
create trigger org_reference_refresh_mv after insert or update or delete on public.org_reference for each statement execute function public.trg_refresh_mv_3w_orgs();
drop trigger if exists org_type_refresh_mv on public.org_type;
create trigger org_type_refresh_mv after insert or update or delete on public.org_type for each statement execute function public.trg_refresh_mv_3w_orgs();

grant select on public.v_3w_orgs, public.v_3w_app, public.v_3w_pairs, public.mv_3w_orgs to anon, authenticated;
