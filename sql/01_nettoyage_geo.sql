-- Nettoyage géographique automatique des lignes 3W (partners_3w).
-- Appliqué à Supabase le 27/09/2026. Voir CLAUDE.md. Tables de référence : admin1_regions, admin2_provinces, admin3_communes, villages, gcorr_commune_alias.

CREATE OR REPLACE FUNCTION public.f_geo_norm(s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select nullif(lower(regexp_replace(public.unaccent(regexp_replace(coalesce(s,''),'\(.*?\)','','g')),'[^a-zA-Z]','','g')),'')
$function$;

create table if not exists public.w3_geo_alias (
  niveau text not null check (niveau in ('adm1','adm2','adm3')),
  nom_norm text not null, parent_pcode text, pcode text not null, commentaire text,
  primary key (niveau, nom_norm, pcode));
alter table public.w3_geo_alias enable row level security;
create policy w3_geo_alias_read on public.w3_geo_alias for select to anon, authenticated using (true);

alter table public.partners_3w
  add column if not exists village text, add column if not exists region_saisie text, add column if not exists province_saisie text,
  add column if not exists commune_saisie text, add column if not exists pcode_saisie text, add column if not exists adm1_pcode text,
  add column if not exists adm2_pcode text, add column if not exists niveau_geo text, add column if not exists methode_geo text,
  add column if not exists communes_citees text[];

create materialized view if not exists public.mv_geo_commune_noms as
  select distinct public.f_geo_norm(x.nom) nom_norm, a.adm3_pcode, a.adm2_pcode, a.adm1_pcode
  from public.admin3_communes a cross join lateral (values (a.adm3_name),(a.adm3_name_fr)) x(nom) where public.f_geo_norm(x.nom) is not null;
create index if not exists mv_geo_commune_noms_idx on public.mv_geo_commune_noms (nom_norm);
create materialized view if not exists public.mv_geo_village_noms as
  select distinct public.f_geo_norm(v.nom) nom_norm, v.adm3_pcode, a.adm2_pcode, a.adm1_pcode
  from public.villages v join public.admin3_communes a using (adm3_pcode) where public.f_geo_norm(v.nom) is not null;
create index if not exists mv_geo_village_noms_idx on public.mv_geo_village_noms (nom_norm);
-- (après une mise à jour d'admin3_communes ou de villages : refresh materialized view public.mv_geo_commune_noms / mv_geo_village_noms)

CREATE OR REPLACE FUNCTION public.f_3w_find_commune(p_nom text, p_adm2 text, p_adm1 text, p_villages boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare n text := public.f_geo_norm(p_nom); r text; c int;
begin
  if n is null or length(n) < 3 then return null; end if;
  -- commune du même nom dans la province
  select min(adm3_pcode), count(distinct adm3_pcode) into r, c from mv_geo_commune_noms where nom_norm = n and adm2_pcode = p_adm2;
  if c = 1 then return r; end if;
  select min(pcode), count(distinct pcode) into r, c from w3_geo_alias where niveau='adm3' and nom_norm = n;
  if c = 1 then return r; end if;
  -- mode village : un village de la province passe avant une commune homonyme ailleurs
  if p_villages then
    select min(adm3_pcode), count(distinct adm3_pcode) into r, c from mv_geo_village_noms where nom_norm = n and adm2_pcode = p_adm2;
    if c = 1 then return r; end if;
    if c > 1 then return null; end if;
  end if;
  select min(adm3_pcode), count(distinct adm3_pcode) into r, c from gcorr_commune_alias where nom_norm = n;
  if c = 1 then return r; end if;
  -- commune du même nom dans la région
  select min(adm3_pcode), count(distinct adm3_pcode) into r, c from mv_geo_commune_noms where nom_norm = n and adm1_pcode = p_adm1;
  if c = 1 then return r; end if;
  if p_villages then
    -- village de la région (jamais au-delà : trop de villages homonymes)
    select min(adm3_pcode), count(distinct adm3_pcode) into r, c from mv_geo_village_noms where nom_norm = n and adm1_pcode = p_adm1;
    if c = 1 then return r; end if;
    return null;
  end if;
  -- commune unique dans le pays (seulement pour la colonne commune)
  select min(adm3_pcode), count(distinct adm3_pcode) into r, c from mv_geo_commune_noms where nom_norm = n;
  if c = 1 then return r; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.f_3w_geo(p_region text, p_province text, p_commune text, p_pcode text, p_village text, OUT adm1 text, OUT adm2 text, OUT adm3 text, OUT niveau text, OUT methode text, OUT citees text[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  rn text := public.f_geo_norm(p_region); pn text := public.f_geo_norm(p_province);
  code text := upper(trim(p_pcode)); tok text; w text; hit text; hits text[] := '{}';
  stop text[] := array['csps','cma','cm','psa','chr','cmu','ds','de','du','des','la','le','les','commune','communes','mairie','ecole','secteur','secteurs','sect','centre','ville','site','sites','village','villages','aire','aires','sanitaire','sanitaires','eae','zad','sat','urbain','magasin','et','ceg','lycee','cea','epp','dans','enceinte','direction','provinciale','regionale','famille','solidarite','action','sociale','tous','toutes','localites','mobile','quartier','non','loti','pdi','ii','iii'];
begin
  select adm1_pcode into adm1 from public.admin1_regions where rn in (public.f_geo_norm(adm1_name), public.f_geo_norm(adm1_name_fr)) limit 1;
  if adm1 is null then select pcode into adm1 from public.w3_geo_alias where niveau='adm1' and nom_norm=rn limit 1; end if;
  select adm2_pcode into adm2 from public.admin2_provinces where pn in (public.f_geo_norm(adm2_name), public.f_geo_norm(adm2_name_fr)) limit 1;
  if adm2 is null then select pcode into adm2 from public.w3_geo_alias where niveau='adm2' and nom_norm=pn limit 1; end if;
  if adm2 is null then select adm2_pcode into adm2 from public.admin2_provinces where adm2_pcode = left(code,6) limit 1; end if;
  if adm1 is null and adm2 is not null then select adm1_pcode into adm1 from public.admin2_provinces where adm2_pcode=adm2; end if;

  if public.f_geo_norm(p_commune) is not null then
    adm3 := public.f_3w_find_commune(p_commune, adm2, adm1, false);
    if adm3 is not null then methode := 'commune';
    elsif exists (select 1 from public.admin3_communes a where a.adm3_pcode = code
                  and public.f_geo_norm(p_commune) in (public.f_geo_norm(a.adm3_name), public.f_geo_norm(a.adm3_name_fr))) then
      adm3 := code; methode := 'commune';
    else
      adm3 := public.f_3w_find_commune(p_commune, adm2, adm1, true);
      if adm3 is not null then methode := 'commune_via_village'; end if;
    end if;
  end if;

  if adm3 is null and p_village ~* '(^|[^s])commune\s+(de\s+|d''\s*)' and p_village !~* 'communes\s+de' and (length(p_village) - length(regexp_replace(p_village, '(?i)commune\s', '', 'g'))) < 16 then
    tok := substring(p_village from '(?i)commune\s+(?:de\s+|d''\s*)([^,;./()]+)');
    hit := public.f_3w_find_commune(tok, adm2, adm1, false);
    if hit is null then hit := public.f_3w_find_commune(split_part(trim(tok),' ',1), adm2, adm1, false); end if;
    if hit is not null then adm3 := hit; methode := 'village'; end if;
  end if;

  if adm3 is null and public.f_geo_norm(p_village) is not null then
    foreach tok in array regexp_split_to_array(regexp_replace(p_village, '\(.*?\)', ' ', 'g'), '\s*(,|;|/|&|:|\.|\s+et\s+|\s+-\s+)\s*') loop
      hit := public.f_3w_find_commune(tok, adm2, adm1, true);
      if hit is null then
        foreach w in array regexp_split_to_array(trim(tok), '\s+') loop
          if length(coalesce(public.f_geo_norm(w),'')) >= 3 and not (public.f_geo_norm(w) = any(stop)) then
            hit := public.f_3w_find_commune(w, adm2, adm1, true);
            if hit is not null and not hit = any(hits) then hits := hits || hit; end if;
          end if;
        end loop;
      elsif not hit = any(hits) then hits := hits || hit;
      end if;
    end loop;
    if array_length(hits,1) = 1 then adm3 := hits[1]; methode := 'village';
    elsif array_length(hits,1) > 1 then citees := hits; methode := 'village_plusieurs_communes';
    end if;
  end if;

  if adm3 is not null then
    select a.adm2_pcode, a.adm1_pcode into adm2, adm1 from public.admin3_communes a where a.adm3_pcode = adm3;
    niveau := 'commune';
  elsif adm2 is not null then
    select adm1_pcode into adm1 from public.admin2_provinces where adm2_pcode = adm2;
    niveau := 'province';
    methode := coalesce(methode, case when public.f_geo_norm(p_commune) is null and public.f_geo_norm(p_village) is null then 'aucune_commune_saisie' else 'commune_non_trouvee' end);
  elsif adm1 is not null then
    niveau := 'region'; methode := coalesce(methode,'province_non_trouvee');
  else
    niveau := 'inconnu'; methode := 'region_non_trouvee';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.trg_3w_clean_geo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare g record;
begin
  if tg_op = 'INSERT' then
    new.region_saisie   := coalesce(new.region_saisie, new.region);
    new.province_saisie := coalesce(new.province_saisie, new.province);
    new.commune_saisie  := coalesce(new.commune_saisie, new.commune);
    new.pcode_saisie    := coalesce(new.pcode_saisie, new.adm3_pcode);
  end if;
  g := public.f_3w_geo(new.region_saisie, new.province_saisie, new.commune_saisie, new.pcode_saisie, new.village);
  new.adm1_pcode := g.adm1; new.adm2_pcode := g.adm2; new.adm3_pcode := g.adm3;
  new.niveau_geo := g.niveau; new.methode_geo := g.methode; new.communes_citees := g.citees;
  new.region   := coalesce((select adm1_name_fr from public.admin1_regions where adm1_pcode = g.adm1), new.region_saisie);
  new.province := coalesce((select adm2_name_fr from public.admin2_provinces where adm2_pcode = g.adm2), new.province_saisie);
  new.commune  := (select adm3_name_fr from public.admin3_communes where adm3_pcode = g.adm3);
  if public.f_geo_norm(new.statut) in ('termine','terminee') then new.statut := 'Terminé'; end if;
  return new;
end $function$;

insert into public.w3_geo_alias (niveau, nom_norm, pcode, commentaire) values
('adm1','koosin','BF61','Koosin est une province du Sourou saisie comme région'),
('adm2','kossin','BF6101','Koosin'),
('adm2','yaagha','BF6403','Yagha'),
('adm3','baskui','BF130004','arrondissement de Ouagadougou'),
('adm3','baskuy','BF130004','arrondissement de Ouagadougou'),
('adm3','bittou','BF480105','bitou (BF4801)'),
('adm3','bobo','BF530102','bobodioulasso (BF5301)'),
('adm3','bogodogo','BF130004','arrondissement de Ouagadougou'),
('adm3','bomborokuy','BF610102','bomborokui (BF6101)'),
('adm3','bondigui','BF570101','gbondjigui (BF5701)'),
('adm3','bondokuy','BF620301','bondokui (BF6203)'),
('adm3','boulmiougou','BF130004','arrondissement de Ouagadougou'),
('adm3','cmkantchari','BF600102','kantchari (BF6001)'),
('adm3','cominyanga','BF480201','kominyanga (BF4802)'),
('adm3','fada','BF630103','forme courte'),
('adm3','gounghin','BF480304','gounguen (BF4803)'),
('adm3','gourcy','BF540403','goursi (BF5404)'),
('adm3','kpere','BF570303','kpuere (BF5703)'),
('adm3','latodin','BF540207','latoden (BF5402)'),
('adm3','matiacoali','BF630104','matiakoali (BF6301)'),
('adm3','nongrmassom','BF130004','arrondissement de Ouagadougou'),
('adm3','nongrmassoum','BF130004','arrondissement de Ouagadougou'),
('adm3','ouaga','BF130004','forme courte'),
('adm3','sabce','BF490107','sabse (BF4901)'),
('adm3','seguenega','BF540310','senguenega (BF5403)'),
('adm3','signoghin','BF130004','arrondissement de Ouagadougou'),
('adm3','signonghin','BF130004','arrondissement de Ouagadougou'),
('adm3','thyou','BF500115','thiou (BF5001)')
on conflict do nothing;

drop trigger if exists partners_3w_clean_geo on public.partners_3w;
create trigger partners_3w_clean_geo
  before insert or update of region_saisie, province_saisie, commune_saisie, pcode_saisie, village
  on public.partners_3w for each row execute function public.trg_3w_clean_geo();
-- Pour renettoyer toutes les lignes existantes : update public.partners_3w set village = village;
