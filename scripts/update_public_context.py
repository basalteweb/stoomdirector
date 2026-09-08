#!/usr/bin/env python3
"""Analysis Power — Local Public Context Sentinel.

Public-only updater executed by GitHub Actions.
No TGM/customer data is read, transmitted or required.

Priority chain:
1. Clermont Auvergne Métropole Explore API v2.1
2. Official Clermont Métropole works pages as a fallback/complement
3. Open-Meteo for weather context
4. Last-known-good local payload if a source is temporarily unavailable

The writer is transactional: a new payload is validated before replacing the
last known good JSON file.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import hashlib
import math
import re
import time
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "public-context.json"
HISTORY_OUT = ROOT / "data" / "public-context-history.json"
STORE_CONFIG = ROOT / "config" / "store.json"
TMP = OUT.with_suffix(".json.tmp")

VERSION = "5.1.0 MERCHANT"
GEOCODE_BASE = "https://data.geopf.fr/geocodage/search/"
API_BASE = "https://opendata.clermontmetropole.eu/api/explore/v2.1"
API_CONSOLE = "https://opendata.clermontmetropole.eu/api/explore/v2.1/console"
CITY_API_BASE = "https://opendata.clermont-ferrand.fr/api/explore/v2.1"
T2C_GTFS_RT = "https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update"
USER_AGENT = "AnalysisUltimate-PublicContext/4.0 (+GitHub Actions; public-data-only)"

KNOWN_DATASETS = {
    "parking": "occupation_parcs_stationnement_metropolitains",
    "addresses": "base-adresse-locale-clermont-auvergne-metropole",
    "roads": "axes-de-voie-de-la-metropole",
    "cvelo_status": "cvelo_station_status",
    "cvelo_stations": "cvelo_station_information",
    "bike_counts": "comptage-velo-jour",
}
AGENDA_DATASET = "agenda-vcf"
ROLE_MATCH_TOKENS = {
    "parking": ["occupation", "stationnement", "parcs"],
    "addresses": ["base", "adresse", "locale"],
    "roads": ["axes", "voie", "metropole"],
    "cvelo_status": ["cvelo", "station", "status"],
    "cvelo_stations": ["cvelo", "station", "information"],
    "bike_counts": ["comptage", "velo", "jour"],
}

WORK_PAGES = {
    "Clermont-Centre": "https://www.clermontmetropole.eu/fr/les-travaux-en-cours/les-travaux-en-cours/travaux-secteur-centre/",
    "Nord & Est": "https://www.clermontmetropole.eu/les-travaux-en-cours/les-travaux-en-cours/travaux-secteurs-nord-est/",
    "Ouest": "https://www.clermontmetropole.eu/les-travaux-en-cours/les-travaux-en-cours/travaux-secteur-ouest/",
    "Sud": "https://www.clermontmetropole.eu/fr/les-travaux-en-cours/les-travaux-en-cours/travaux-secteur-sud/",
}

RELEVANCE_TERMS = {
    "travaux": 9,
    "chantier": 9,
    "circulation": 8,
    "voirie": 7,
    "route": 5,
    "stationnement": 6,
    "parking": 6,
    "mobilite": 5,
    "mobilité": 5,
    "inspire": 7,
    "deviation": 7,
    "déviation": 7,
    "fermeture": 7,
    "rue": 2,
    "voie": 2,
    "transport": 5,
    "tramway": 7,
    "t2c": 9,
    "velo": 5,
    "vélo": 5,
    "comptage": 4,
    "evenement": 5,
    "événement": 5,
}
EXCLUDE_TERMS = {
    "marches publics": 40,
    "marchés publics": 40,
    "liste des marches": 40,
    "marches superieurs": 40,
    "budget": 30,
    "achat public": 40,
    "subvention": 30,
    "patrimoine": 18,
    "archeologique": 18,
}


def load_store_profile(old: dict[str, Any]) -> dict[str, Any]:
    cfg = read_json(STORE_CONFIG, {}) if STORE_CONFIG.exists() else {}
    previous = old.get("store_profile", {}) if isinstance(old, dict) else {}
    profile = {
        "name": compact_text(cfg.get("name") or previous.get("name") or "Point de vente", 120),
        "address": compact_text(cfg.get("address") or previous.get("address") or "", 300),
        "immediate_radius_m": int(safe_float(cfg.get("immediate_radius_m")) or previous.get("immediate_radius_m") or 100),
        "commercial_radius_m": int(safe_float(cfg.get("commercial_radius_m")) or previous.get("commercial_radius_m") or 500),
        "extended_radius_m": int(safe_float(cfg.get("extended_radius_m")) or previous.get("extended_radius_m") or 2000),
    }
    return profile


def geocode_query(query: str, cache: dict[str, Any]) -> dict[str, Any] | None:
    q = compact_text(query, 300)
    if not q:
        return None
    key = norm(q)
    cached = cache.get(key)
    if isinstance(cached, dict) and cached.get("lat") is not None and cached.get("lon") is not None:
        return cached
    try:
        data = HTTP.get_json(GEOCODE_BASE + "?" + urlencode({"q": q, "limit": 1}))
        feature = (data.get("features") or [None])[0] if isinstance(data, dict) else None
        coords = ((feature or {}).get("geometry") or {}).get("coordinates") or []
        props = (feature or {}).get("properties") or {}
        if len(coords) < 2:
            return None
        result = {
            "lat": safe_float(coords[1]),
            "lon": safe_float(coords[0]),
            "label": compact_text(props.get("label") or q, 250),
            "city": compact_text(props.get("city") or props.get("municipality") or "", 120),
            "postcode": compact_text(props.get("postcode") or "", 20),
            "citycode": compact_text(props.get("citycode") or "", 20),
            "score": safe_float(props.get("score")),
            "source": "Géoplateforme / Base Adresse Nationale",
            "checked_at": iso_now(),
        }
        if result["lat"] is None or result["lon"] is None:
            return None
        cache[key] = result
        return result
    except Exception:
        return None


def distance_m(a_lat: Any, a_lon: Any, b_lat: Any, b_lon: Any) -> int | None:
    vals = [safe_float(x) for x in (a_lat, a_lon, b_lat, b_lon)]
    if any(x is None for x in vals):
        return None
    lat1, lon1, lat2, lon2 = [math.radians(float(x)) for x in vals]
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return int(round(6371000 * 2 * math.asin(math.sqrt(h))))


def enrich_local_context(rows: list[dict[str, Any]], store: dict[str, Any], cache: dict[str, Any], *, geocode_place: bool = False) -> list[dict[str, Any]]:
    out = []
    store_lat, store_lon = store.get("lat"), store.get("lon")
    city = store.get("city") or ""
    for item in rows:
        row = dict(item)
        lat = safe_float(row.get("lat") or row.get("latitude"))
        lon = safe_float(row.get("lon") or row.get("lng") or row.get("longitude"))
        if (lat is None or lon is None) and geocode_place and row.get("place"):
            place = str(row.get("place"))
            query = place if any(x in norm(place) for x in ["clermont ferrand", "aulnat", "durtol", "royat", "orcines", "cournon", "cendre"]) else f"{place}, {city}"
            geo = geocode_query(query, cache)
            if geo:
                lat, lon = geo.get("lat"), geo.get("lon")
                row["geocode_label"] = geo.get("label")
                row["geocode_score"] = geo.get("score")
        if lat is not None and lon is not None:
            row["lat"], row["lon"] = lat, lon
            row["distance_m"] = distance_m(store_lat, store_lon, lat, lon)
        row["source_label"] = row.get("source_label") or ("Clermont Auvergne Métropole" if "clermontmetropole.eu" in str(row.get("source") or "") else "Source publique")
        row["official_description"] = row.get("official_description") or row.get("text") or row.get("description") or ""
        out.append(row)
    return out


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()


def norm(value: Any) -> str:
    s = "" if value is None else str(value)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def compact_text(value: Any, limit: int = 700) -> str:
    s = re.sub(r"\s+", " ", "" if value is None else str(value)).strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    s = str(value).strip().replace("\u202f", "").replace(" ", "").replace(",", ".")
    s = re.sub(r"[^0-9.\-]", "", s)
    try:
        x = float(s)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


class HttpClient:
    def __init__(self, retries: int = 3, timeout: int = 30):
        self.retries = retries
        self.timeout = timeout

    def get_bytes(self, url: str, *, accept: str = "application/json,text/plain,*/*") -> bytes:
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                req = Request(
                    url,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Accept": accept,
                        "Cache-Control": "no-cache",
                    },
                )
                with urlopen(req, timeout=self.timeout) as r:
                    if getattr(r, "status", 200) >= 400:
                        raise RuntimeError(f"HTTP {r.status}")
                    return r.read()
            except (HTTPError, URLError, TimeoutError, OSError, RuntimeError) as exc:
                last = exc
                if attempt + 1 < self.retries:
                    time.sleep(1.5 * (2**attempt))
        raise RuntimeError(f"GET failed after {self.retries} attempts: {url} — {last}")

    def get_json(self, url: str) -> dict[str, Any]:
        raw = self.get_bytes(url, accept="application/json")
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError(f"Invalid JSON from {url}: {exc}") from exc
        if not isinstance(obj, dict):
            raise RuntimeError(f"Unexpected JSON shape from {url}")
        return obj

    def get_text(self, url: str) -> str:
        raw = self.get_bytes(url, accept="text/html,text/plain,*/*")
        return raw.decode("utf-8", "replace")


HTTP = HttpClient()


def api_url(path: str, *, base: str = API_BASE, **params: Any) -> str:
    q = {k: v for k, v in params.items() if v is not None}
    return f"{base}{path}" + ("?" + urlencode(q, doseq=True) if q else "")


def api_health() -> dict[str, Any]:
    started = time.perf_counter()
    try:
        obj = HTTP.get_json(api_url("/catalog/datasets", limit=1, offset=0))
        elapsed = round((time.perf_counter() - started) * 1000)
        return {
            "ok": isinstance(obj.get("results"), list),
            "latency_ms": elapsed,
            "total_datasets": obj.get("total_count"),
            "endpoint": API_BASE,
            "checked_at": iso_now(),
            "error": None,
        }
    except Exception as exc:
        return {
            "ok": False,
            "latency_ms": None,
            "total_datasets": None,
            "endpoint": API_BASE,
            "checked_at": iso_now(),
            "error": compact_text(exc),
        }


def catalog_all(max_pages: int = 10) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    offset = 0
    limit = 100
    for _ in range(max_pages):
        obj = HTTP.get_json(api_url("/catalog/datasets", limit=limit, offset=offset))
        batch = obj.get("results") or []
        if not isinstance(batch, list):
            raise RuntimeError("catalog.results is not a list")
        results.extend(x for x in batch if isinstance(x, dict))
        total = int(obj.get("total_count") or len(results))
        if len(results) >= total or not batch:
            break
        offset += len(batch)
    return results


def dataset_id(ds: dict[str, Any]) -> str:
    return str(ds.get("dataset_id") or ds.get("datasetid") or ds.get("id") or "").strip()


def dataset_meta_default(ds: dict[str, Any]) -> dict[str, Any]:
    metas = ds.get("metas") or {}
    if isinstance(metas, dict):
        default = metas.get("default") or metas.get("dcat") or {}
        return default if isinstance(default, dict) else {}
    return {}


def dataset_title(ds: dict[str, Any]) -> str:
    meta = dataset_meta_default(ds)
    return compact_text(meta.get("title") or ds.get("title") or dataset_id(ds), 240)


def dataset_description(ds: dict[str, Any]) -> str:
    meta = dataset_meta_default(ds)
    return compact_text(meta.get("description") or ds.get("description") or "", 900)


def dataset_processed(ds: dict[str, Any]) -> str | None:
    meta = dataset_meta_default(ds)
    return meta.get("data_processed") or meta.get("modified") or ds.get("data_processed") or None


def relevance(ds: dict[str, Any]) -> int:
    text = norm(" ".join([dataset_title(ds), dataset_description(ds), dataset_id(ds)]))
    score = 0
    for term, weight in RELEVANCE_TERMS.items():
        if norm(term) in text:
            score += weight
    for term, weight in EXCLUDE_TERMS.items():
        if norm(term) in text:
            score -= weight
    return score


def resolve_known_datasets(catalog: list[dict[str, Any]]) -> dict[str, str]:
    ids={dataset_id(ds):ds for ds in catalog if dataset_id(ds)}
    resolved={}
    for role, preferred in KNOWN_DATASETS.items():
        if preferred in ids:
            resolved[role]=preferred
            continue
        tokens=ROLE_MATCH_TOKENS[role]
        candidates=[]
        for ds in catalog:
            text=norm(" ".join([dataset_title(ds), dataset_description(ds), dataset_id(ds)]))
            score=sum(1 for t in tokens if norm(t) in text)
            if score:
                candidates.append((score,dataset_id(ds)))
        candidates.sort(reverse=True)
        resolved[role]=candidates[0][1] if candidates and candidates[0][0]>=max(2,len(tokens)-1) else preferred
    return resolved


def discover_relevant(catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for ds in catalog:
        did = dataset_id(ds)
        if not did:
            continue
        score = relevance(ds)
        if did in KNOWN_DATASETS.values():
            score += 100
        if score >= 7:
            out.append(
                {
                    "dataset_id": did,
                    "title": dataset_title(ds),
                    "description": dataset_description(ds),
                    "score": score,
                    "data_processed": dataset_processed(ds),
                    "has_records": bool(ds.get("has_records", True)),
                }
            )
    return sorted(out, key=lambda x: (-x["score"], x["title"]))[:30]


def get_dataset_meta(did: str) -> dict[str, Any]:
    return HTTP.get_json(api_url(f"/catalog/datasets/{quote(did, safe='')}"))


def get_records(did: str, limit: int = 100, offset: int = 0, select: str | None = None, *, base: str = API_BASE, order_by: str | None = None, where: str | None = None) -> dict[str, Any]:
    return HTTP.get_json(
        api_url(
            f"/catalog/datasets/{quote(did, safe='')}/records",
            base=base,
            limit=max(1, min(limit, 100)),
            offset=max(0, offset),
            select=select,
            order_by=order_by,
            where=where,
        )
    )


def records_pages(did: str, *, base: str = API_BASE, max_records: int = 500) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while len(out) < max_records:
        obj = get_records(did, min(100, max_records-len(out)), offset, base=base)
        rows = obj.get("results") or []
        if not isinstance(rows, list) or not rows:
            break
        out.extend(x for x in rows if isinstance(x, dict))
        offset += len(rows)
        if offset >= int(obj.get("total_count") or offset):
            break
    return out[:max_records]


def compact_record(record: dict[str, Any], max_fields: int = 14) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, val in record.items():
        if len(result) >= max_fields:
            break
        if isinstance(val, (dict, list)):
            # Keep simple coordinates if present, otherwise avoid large structures.
            if isinstance(val, dict) and set(val.keys()) >= {"lat", "lon"}:
                result[key] = {"lat": val.get("lat"), "lon": val.get("lon")}
            continue
        if val is None or val == "":
            continue
        result[key] = compact_text(val, 220)
    return result


def pick(record: dict[str, Any], include: Iterable[str], exclude: Iterable[str] = ()) -> Any:
    inc = [norm(x) for x in include]
    exc = [norm(x) for x in exclude]
    best = None
    best_score = -1
    for key, value in record.items():
        nk = norm(key)
        if any(x in nk for x in exc):
            continue
        score = sum(3 if nk == x else 1 for x in inc if x and x in nk)
        if score > best_score and score > 0 and value not in (None, ""):
            best, best_score = value, score
    return best


def extract_geo(record: dict[str, Any]) -> tuple[float | None, float | None]:
    for val in record.values():
        if isinstance(val, dict):
            lat = safe_float(val.get("lat") or val.get("latitude"))
            lon = safe_float(val.get("lon") or val.get("lng") or val.get("longitude"))
            if lat is not None and lon is not None:
                return lat, lon
        if isinstance(val, (list, tuple)) and len(val) >= 2:
            a, b = safe_float(val[0]), safe_float(val[1])
            if a is not None and b is not None:
                # GeoJSON order is usually lon, lat.
                if abs(a) <= 180 and abs(b) <= 90:
                    return b, a
    lat = safe_float(pick(record, ["latitude", "lat"]))
    lon = safe_float(pick(record, ["longitude", "lon", "lng"]))
    return lat, lon


def normalize_parking_record(record: dict[str, Any]) -> dict[str, Any]:
    name = pick(record, ["nom", "libelle", "parking", "parc"])
    capacity = safe_float(pick(record, ["capacite", "capacite vl", "places total", "nb places", "total"], ["dispon", "libre", "occupe"]))
    available = safe_float(pick(record, ["disponible", "libre", "places libres", "places dispo"], ["taux"]))
    occupied = safe_float(pick(record, ["occupees", "occupe", "occupied"], ["taux"]))
    rate = safe_float(pick(record, ["taux occupation", "occupation", "remplissage"], ["places", "nb"]))
    if rate is not None and 0 <= rate <= 1.01:
        rate *= 100
    if rate is None and capacity and capacity > 0:
        if occupied is not None:
            rate = occupied / capacity * 100
        elif available is not None:
            rate = (capacity - available) / capacity * 100
    lat, lon = extract_geo(record)
    status = pick(record, ["statut", "status", "etat"])
    updated = pick(record, ["date", "horodatage", "timestamp", "maj", "mise a jour"])
    return {
        "name": compact_text(name or "Parking métropolitain", 140),
        "capacity": capacity,
        "available": available,
        "occupied": occupied,
        "occupancy_pct": round(rate, 2) if rate is not None else None,
        "status": compact_text(status, 80) if status is not None else None,
        "updated": compact_text(updated, 100) if updated is not None else None,
        "lat": lat,
        "lon": lon,
        "raw": compact_record(record),
    }


def fetch_parking(did: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started = time.perf_counter()
    try:
        obj = get_records(did, 100)
        rows = obj.get("results") or []
        if not isinstance(rows, list):
            raise RuntimeError("parking results invalid")
        normalized = [normalize_parking_record(r) for r in rows if isinstance(r, dict)]
        return normalized, {
            "ok": True,
            "dataset_id": did,
            "records": len(normalized),
            "total_count": obj.get("total_count"),
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "error": None,
        }
    except Exception as exc:
        return [], {
            "ok": False,
            "dataset_id": did,
            "records": 0,
            "total_count": None,
            "latency_ms": None,
            "error": compact_text(exc),
        }




def normalize_cvelo_status(record: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    station_id = compact_text(pick(record, ["station id", "station_id", "id station", "id"]) or "", 80)
    name = names.get(station_id) or pick(record, ["name", "nom", "station"])
    bikes = safe_float(pick(record, ["num bikes available", "velos disponibles", "bikes available", "nb velos", "velo disponible"]))
    docks = safe_float(pick(record, ["num docks available", "places disponibles", "docks available", "nb places", "emplacements disponibles"]))
    installed = pick(record, ["is installed", "installee", "installed"])
    renting = pick(record, ["is renting", "location", "renting"])
    returning = pick(record, ["is returning", "retour", "returning"])
    return {"station_id": station_id, "name": compact_text(name or station_id or "Station C.vélo", 140), "bikes_available": bikes, "docks_available": docks, "installed": installed, "renting": renting, "returning": returning, "raw": compact_record(record)}


def fetch_cvelo(status_did: str, info_did: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started = time.perf_counter()
    try:
        infos = records_pages(info_did, max_records=250)
        names: dict[str, str] = {}
        for r in infos:
            sid = compact_text(pick(r, ["station id", "station_id", "id station", "id"]) or "", 80)
            name = pick(r, ["name", "nom", "station"])
            if sid and name:
                names[sid] = compact_text(name, 140)
        rows = records_pages(status_did, max_records=250)
        stations = [normalize_cvelo_status(r, names) for r in rows]
        bikes = [x["bikes_available"] for x in stations if x.get("bikes_available") is not None]
        docks = [x["docks_available"] for x in stations if x.get("docks_available") is not None]
        return stations, {"ok": True, "records": len(stations), "bikes_available": round(sum(bikes), 1) if bikes else None, "docks_available": round(sum(docks), 1) if docks else None, "latency_ms": round((time.perf_counter()-started)*1000), "error": None}
    except Exception as exc:
        return [], {"ok": False, "records": 0, "bikes_available": None, "docks_available": None, "latency_ms": None, "error": compact_text(exc)}


def normalize_bike_count(record: dict[str, Any]) -> dict[str, Any]:
    date = pick(record, ["date", "jour", "day"])
    count = safe_float(pick(record, ["comptage", "nombre", "nb velos", "passages", "count", "total"], ["id", "latitude", "longitude"]))
    name = pick(record, ["nom", "libelle", "compteur", "capteur", "site", "voie"])
    lat, lon = extract_geo(record)
    return {"date": compact_text(date, 80) if date is not None else None, "count": count, "name": compact_text(name or "Compteur vélo", 140), "lat": lat, "lon": lon}


def fetch_bike_counts(did: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started=time.perf_counter()
    try:
        rows=records_pages(did,max_records=500)
        data=[normalize_bike_count(r) for r in rows]
        usable=[x for x in data if x.get("date") and x.get("count") is not None]
        return usable,{"ok":True,"records":len(usable),"latency_ms":round((time.perf_counter()-started)*1000),"error":None}
    except Exception as exc:
        return [],{"ok":False,"records":0,"latency_ms":None,"error":compact_text(exc)}


def normalize_agenda(record: dict[str, Any]) -> dict[str, Any]:
    title=pick(record,["titre","title","nom","name","intitule"])
    start=pick(record,["date debut","date_debut","debut","start date","start"])
    end=pick(record,["date fin","date_fin","fin","end date","end"])
    place=pick(record,["lieu","place","adresse","location","commune","ville"])
    category=pick(record,["type","categorie","category","theme","thematique"])
    lat,lon=extract_geo(record)
    return {"title":compact_text(title or "Événement clermontois",180),"start":compact_text(start,100) if start is not None else None,"end":compact_text(end,100) if end is not None else None,"place":compact_text(place,180) if place is not None else None,"category":compact_text(category,120) if category is not None else None,"lat":lat,"lon":lon,"source_type":"agenda_officiel"}


def fetch_agenda() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started=time.perf_counter()
    try:
        rows=records_pages(AGENDA_DATASET,base=CITY_API_BASE,max_records=500)
        events=[normalize_agenda(r) for r in rows]
        return events,{"ok":True,"records":len(events),"latency_ms":round((time.perf_counter()-started)*1000),"error":None}
    except Exception as exc:
        return [],{"ok":False,"records":0,"latency_ms":None,"error":compact_text(exc)}


def event_id(item: dict[str, Any]) -> str:
    raw="|".join([norm(item.get("title")),norm(item.get("start")),norm(item.get("place"))])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def merge_event_history(old: dict[str, Any], current: list[dict[str, Any]], now_iso: str) -> list[dict[str, Any]]:
    prev=old.get("agenda_history",[]) if isinstance(old,dict) else []
    if not isinstance(prev,list): prev=[]
    by={str(x.get("event_id") or event_id(x)):dict(x) for x in prev if isinstance(x,dict)}
    for raw in current:
        row=dict(raw); eid=event_id(row); oldrow=by.get(eid,{})
        row.update({"event_id":eid,"first_seen":oldrow.get("first_seen") or now_iso,"last_seen":now_iso,"active":True})
        by[eid]=row
    current_ids={event_id(x) for x in current}
    for eid,row in by.items():
        if eid not in current_ids: row["active"]=False
    return list(by.values())[-2500:]


def fetch_t2c() -> dict[str, Any]:
    started=time.perf_counter()
    try:
        raw=HTTP.get_bytes(T2C_GTFS_RT,accept="application/x-protobuf,application/octet-stream,*/*")
        summary={"ok":True,"decoded":False,"bytes":len(raw),"trip_updates":None,"service_alerts":None,"vehicle_positions":None,"delayed_updates":None,"avg_delay_seconds":None,"max_delay_seconds":None,"latency_ms":round((time.perf_counter()-started)*1000),"error":None}
        try:
            from google.transit import gtfs_realtime_pb2  # type: ignore
            feed=gtfs_realtime_pb2.FeedMessage(); feed.ParseFromString(raw)
            trips=alerts=vehicles=0; delays=[]; cancelled=0
            for e in feed.entity:
                if e.HasField("trip_update"):
                    trips+=1
                    try:
                        if int(e.trip_update.trip.schedule_relationship)==3: cancelled+=1
                    except Exception: pass
                    for stu in e.trip_update.stop_time_update:
                        for evt in (stu.arrival,stu.departure):
                            try:
                                if evt.HasField("delay") and evt.delay: delays.append(int(evt.delay))
                            except Exception: pass
                if e.HasField("alert"): alerts+=1
                if e.HasField("vehicle"): vehicles+=1
            summary.update({"decoded":True,"trip_updates":trips,"service_alerts":alerts,"vehicle_positions":vehicles,"cancelled_trips":cancelled,"delayed_updates":sum(1 for x in delays if x>60),"avg_delay_seconds":round(sum(delays)/len(delays),1) if delays else 0,"max_delay_seconds":max(delays) if delays else 0})
        except Exception as dec:
            summary["decode_warning"]=compact_text(dec)
        return summary
    except Exception as exc:
        return {"ok":False,"decoded":False,"bytes":0,"trip_updates":None,"service_alerts":None,"vehicle_positions":None,"delayed_updates":None,"avg_delay_seconds":None,"max_delay_seconds":None,"latency_ms":None,"error":compact_text(exc)}


def verify_dataset(did: str) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        meta = get_dataset_meta(did)
        ds = meta.get("dataset") if isinstance(meta.get("dataset"), dict) else meta
        title = dataset_title(ds if isinstance(ds, dict) else {})
        fields = (ds or {}).get("fields") if isinstance(ds, dict) else None
        return {
            "ok": True,
            "dataset_id": did,
            "title": title or did,
            "field_count": len(fields) if isinstance(fields, list) else None,
            "data_processed": dataset_processed(ds if isinstance(ds, dict) else {}),
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "error": None,
        }
    except Exception as exc:
        return {
            "ok": False,
            "dataset_id": did,
            "title": did,
            "field_count": None,
            "data_processed": None,
            "latency_ms": None,
            "error": compact_text(exc),
        }


def infer_sector_from_text(text: str) -> str:
    t = norm(text)
    if any(x in t for x in ["aulnat", "gerzat", "lempdes", "pont du chateau", "cebazat", "blanzat", "chateaugay", "nord est"]):
        return "Nord & Est"
    if any(x in t for x in ["chamalieres", "durtol", "orcines", "royat", "ouest"]):
        return "Ouest"
    if any(x in t for x in ["aubiere", "beaumont", "ceyrat", "cournon", "romagnat", "le cendre", "sud"]):
        return "Sud"
    if "clermont ferrand" in t or "clermont" in t or "centre" in t:
        return "Clermont-Centre"
    return "Métropole / secteur non déterminé"


def record_text(record: dict[str, Any]) -> str:
    parts = []
    for key, val in record.items():
        if isinstance(val, (dict, list)) or val in (None, ""):
            continue
        if any(x in norm(key) for x in ["objectid", "identifiant", "id technique", "geo shape"]):
            continue
        parts.append(f"{key}: {val}")
    return compact_text(" · ".join(parts), 900)


def api_context_candidates(discovered: list[dict[str, Any]], excluded_ids: set[str] | None = None, max_datasets: int = 10) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    status: list[dict[str, Any]] = []
    excluded_ids = excluded_ids or set(KNOWN_DATASETS.values())
    eligible=[]
    for x in discovered:
        if x["dataset_id"] in excluded_ids: continue
        meta=norm(f"{x.get('title','')} {x.get('description','')} {x.get('dataset_id','')}")
        if any(t in meta for t in ["marche public","marches superieurs","subvention","budget","patrimoine","archeolog"]): continue
        if not any(t in meta for t in ["circulation","voirie","chantier","route","fermeture","deviation","stationnement","trafic","inspire","mobilite","transport"]): continue
        eligible.append(x)
    for ds in eligible[:max_datasets]:
        did = ds["dataset_id"]
        started = time.perf_counter()
        try:
            obj = get_records(did, 100)
            rows = obj.get("results") or []
            if not isinstance(rows, list):
                raise RuntimeError("results invalid")
            status.append({
                "ok": True,
                "dataset_id": did,
                "title": ds["title"],
                "records_sampled": len(rows),
                "total_count": obj.get("total_count"),
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "error": None,
            })
            for r in rows[:100]:
                if not isinstance(r, dict):
                    continue
                text = record_text(r)
                nt = norm(text)
                operational = any(norm(term) in nt for term in ["chantier", "circulation", "route barr", "fermeture", "deviation", "déviation", "inspire", "sens unique", "stationnement", "voirie"])
                generic_works = "travaux" in nt and any(term in nt for term in ["rue", "route", "avenue", "boulevard", "circulation", "voie"])
                if not (operational or generic_works):
                    continue
                place = pick(r, ["lieu", "voie", "rue", "adresse", "commune", "libelle", "nom"])
                start = pick(r, ["date debut", "debut", "start"])
                end = pick(r, ["date fin", "fin", "end"])
                official = pick(r, ["description", "descriptif", "objet", "intitule", "intitulé", "libelle", "libellé", "nature", "commentaire", "observation"])
                events.append({
                    "sector": infer_sector_from_text(text),
                    "place": compact_text(place or ds["title"], 180),
                    "text": text,
                    "official_description": compact_text(official if official not in (None, "") else text, 900),
                    "source_record": text,
                    "start": compact_text(start, 80) if start is not None else None,
                    "end": compact_text(end, 80) if end is not None else None,
                    "source": f"{API_BASE}/catalog/datasets/{did}",
                    "source_type": "clermont_api",
                    "dataset_id": did,
                })
        except Exception as exc:
            status.append({
                "ok": False,
                "dataset_id": did,
                "title": ds["title"],
                "records_sampled": 0,
                "total_count": None,
                "latency_ms": None,
                "error": compact_text(exc),
            })
    return dedupe_works(events), status


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag in ("h1", "h2", "h3", "h4", "p", "li", "td", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1
        if tag in ("h1", "h2", "h3", "h4", "p", "li", "td"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def works_for_sector(sector: str, url: str) -> list[dict[str, Any]]:
    raw = HTTP.get_text(url)
    parser = TextParser()
    parser.feed(raw)
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(parser.parts))
    lines = [x.strip() for x in re.sub(r"\n+", "\n", text).split("\n") if len(x.strip()) >= 4]
    items = []
    current_place = ""
    for i, line in enumerate(lines):
        low = line.lower()
        if low.startswith("travaux à "):
            current_place = line[10:].strip()
        impact_words = (
            "route barrée",
            "circulation",
            "fermeture",
            "déviation",
            "sens unique",
            "travaux",
            "aménagement",
            "réseaux",
            "chantier",
            "inspire",
        )
        if any(w in low for w in impact_words) and not low.startswith("travaux secteur"):
            context = " · ".join(lines[max(0, i - 1) : min(len(lines), i + 2)])
            items.append(
                {
                    "sector": sector,
                    "place": compact_text(current_place, 180),
                    "text": compact_text(context, 700),
                    "official_description": compact_text(line, 700),
                    "source_record": compact_text(context, 900),
                    "source": url,
                    "source_type": "official_page",
                    "dataset_id": None,
                }
            )
    return dedupe_works(items)[:100]




def work_event_id(item: dict[str, Any]) -> str:
    raw = "|".join([norm(item.get("sector")), norm(item.get("place")), norm(item.get("text"))[:320]])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def merge_work_history(old: dict[str, Any], current: list[dict[str, Any]], now_iso: str) -> list[dict[str, Any]]:
    previous = old.get("works_history", []) if isinstance(old, dict) else []
    if not isinstance(previous, list):
        previous = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in previous:
        if not isinstance(row, dict):
            continue
        eid = str(row.get("event_id") or work_event_id(row))
        by_id[eid] = dict(row, event_id=eid, active=False)
    current_ids=set()
    for raw in current:
        row=dict(raw)
        eid=work_event_id(row); current_ids.add(eid)
        prev=by_id.get(eid,{})
        row["event_id"]=eid
        row["active"]=True
        row["first_seen"]=prev.get("first_seen") or now_iso
        row["last_seen"]=now_iso
        row["observed_end"]=None
        by_id[eid]=row
    for eid,row in list(by_id.items()):
        if eid in current_ids:
            continue
        row["active"]=False
        row["observed_end"]=row.get("observed_end") or row.get("last_seen") or now_iso
    # Keep at most roughly one year of observed context; undated legacy entries are kept.
    cutoff=utcnow()-dt.timedelta(days=400)
    kept=[]
    for row in by_id.values():
        stamp=row.get("last_seen") or row.get("first_seen")
        try:
            parsed=dt.datetime.fromisoformat(str(stamp).replace("Z","+00:00")) if stamp else None
        except Exception:
            parsed=None
        if row.get("active") or parsed is None or parsed>=cutoff:
            kept.append(row)
    kept.sort(key=lambda x:(not bool(x.get("active")), str(x.get("sector")), str(x.get("place"))))
    return kept[:1200]

def dedupe_works(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    out = []
    for item in items:
        key = (norm(item.get("sector")), norm(item.get("place")), norm(item.get("text"))[:240])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def merge_works(api_items: list[dict[str, Any]], page_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # API first, pages supplement. Similar entries are kept only once.
    out: list[dict[str, Any]] = []
    signatures: list[tuple[str, set[str]]] = []
    for item in api_items + page_items:
        text = norm(" ".join([str(item.get("sector", "")), str(item.get("place", "")), str(item.get("text", ""))]))
        tokens = {x for x in text.split() if len(x) >= 4}
        duplicate = False
        for sector, prev in signatures:
            if sector != norm(item.get("sector")):
                continue
            overlap = len(tokens & prev) / max(1, min(len(tokens), len(prev)))
            if overlap >= 0.72:
                duplicate = True
                break
        if not duplicate:
            out.append(item)
            signatures.append((norm(item.get("sector")), tokens))
    return out[:250]


def weather(latitude: float = 45.7772, longitude: float = 3.0870) -> list[dict[str, Any]]:
    url = (
        f"https://api.open-meteo.com/v1/forecast?latitude={latitude:.6f}&longitude={longitude:.6f}"
        "&past_days=92&forecast_days=7&timezone=Europe%2FParis"
        "&daily=temperature_2m_mean,precipitation_sum,rain_sum,snowfall_sum"
    )
    data = HTTP.get_json(url)
    d = data.get("daily", {}) if isinstance(data, dict) else {}
    times = d.get("time", []) or []
    out = []
    for i, date in enumerate(times):
        def at(key: str) -> Any:
            arr = d.get(key) or []
            return arr[i] if i < len(arr) else None
        out.append(
            {
                "date": date,
                "temperature_mean": at("temperature_2m_mean"),
                "precipitation_mm": at("precipitation_sum"),
                "rain_mm": at("rain_sum"),
                "snowfall_cm": at("snowfall_sum"),
            }
        )
    return out


def source_state(name: str, ok: bool, *, detail: str = "", error: str | None = None, url: str | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "ok": bool(ok),
        "checked_at": iso_now(),
        "detail": compact_text(detail, 350),
        "error": compact_text(error, 350) if error else None,
        "url": url,
    }


def validate_payload(payload: dict[str, Any]) -> list[str]:
    errors = []
    if payload.get("schema_version") != 2:
        errors.append("schema_version must be 2")
    if not isinstance(payload.get("works"), list):
        errors.append("works must be a list")
    if not isinstance(payload.get("weather"), list):
        errors.append("weather must be a list")
    if not isinstance(payload.get("works_history"), list):
        errors.append("works_history must be a list")
    if not isinstance(payload.get("source_health"), list):
        errors.append("source_health must be a list")
    for key in ("agenda", "agenda_history", "cvelo", "bike_counts"):
        if key in payload and not isinstance(payload.get(key), list):
            errors.append(f"{key} must be a list")
    if "t2c" in payload and not isinstance(payload.get("t2c"), dict):
        errors.append("t2c must be an object")
    api = payload.get("clermont_api")
    if not isinstance(api, dict):
        errors.append("clermont_api missing")
    elif not isinstance(api.get("health"), dict):
        errors.append("clermont_api.health missing")
    return errors


def update_history(payload: dict[str, Any]) -> None:
    history = read_json(HISTORY_OUT, {"schema_version": 1, "snapshots": []})
    snapshots = history.get("snapshots") if isinstance(history, dict) else []
    if not isinstance(snapshots, list):
        snapshots = []
    parking_rates = [safe_float(x.get("occupancy_pct")) for x in payload.get("parking", [])]
    parking_rates = [x for x in parking_rates if x is not None]
    by_sector: dict[str, int] = {}
    for w in payload.get("works", []):
        sec = str(w.get("sector") or "Non déterminé")
        by_sector[sec] = by_sector.get(sec, 0) + 1
    snapshot = {
        "generated_at": payload.get("generated_at"),
        "status": payload.get("status"),
        "api_ok": bool(payload.get("clermont_api", {}).get("health", {}).get("ok")),
        "api_total_datasets": payload.get("clermont_api", {}).get("health", {}).get("total_datasets"),
        "works_count": len(payload.get("works", [])),
        "works_by_sector": by_sector,
        "parking_avg_occupancy_pct": round(sum(parking_rates) / len(parking_rates), 2) if parking_rates else None,
        "parking_records": len(payload.get("parking", [])),
        "weather_days": len(payload.get("weather", [])),
        "agenda_records": len(payload.get("agenda", [])),
        "cvelo_bikes_available": payload.get("cvelo_status", {}).get("bikes_available"),
        "cvelo_docks_available": payload.get("cvelo_status", {}).get("docks_available"),
        "t2c_trip_updates": payload.get("t2c", {}).get("trip_updates"),
        "t2c_avg_delay_seconds": payload.get("t2c", {}).get("avg_delay_seconds"),
        "t2c_delayed_updates": payload.get("t2c", {}).get("delayed_updates"),
        "bike_count_records": len(payload.get("bike_counts", [])),
    }
    if snapshots and snapshots[-1].get("generated_at", "")[:13] == str(snapshot["generated_at"])[:13]:
        snapshots[-1] = snapshot
    else:
        snapshots.append(snapshot)
    snapshots = snapshots[-2160:]
    HISTORY_OUT.write_text(json.dumps({"schema_version": 1, "snapshots": snapshots}, ensure_ascii=False, separators=(",", ":")), "utf-8")


def main() -> None:
    old = read_json(OUT, {})
    errors: list[str] = []
    source_health: list[dict[str, Any]] = []
    geocode_cache = dict(old.get("geocode_cache", {})) if isinstance(old.get("geocode_cache"), dict) else {}
    store_profile = load_store_profile(old)
    store_geo = geocode_query(store_profile.get("address", ""), geocode_cache)
    if store_geo:
        store_profile.update({"lat": store_geo.get("lat"), "lon": store_geo.get("lon"), "city": store_geo.get("city"), "postcode": store_geo.get("postcode"), "citycode": store_geo.get("citycode"), "geocode_label": store_geo.get("label"), "geocode_score": store_geo.get("score"), "geocoded_at": store_geo.get("checked_at")})
        source_health.append(source_state("Géocodage commerce · Géoplateforme/BAN", True, detail=store_profile.get("geocode_label") or store_profile.get("address"), url=GEOCODE_BASE))
    elif store_profile.get("address"):
        source_health.append(source_state("Géocodage commerce · Géoplateforme/BAN", False, error="Adresse non géocodée lors de cette synchronisation", url=GEOCODE_BASE))

    health = api_health()
    source_health.append(source_state("Clermont Métropole Explore API", health["ok"], detail=f"{health.get('total_datasets') or '—'} jeux détectés · {health.get('latency_ms') or '—'} ms", error=health.get("error"), url=API_CONSOLE))

    catalog: list[dict[str, Any]] = []
    discovered: list[dict[str, Any]] = []
    if health["ok"]:
        try:
            catalog = catalog_all()
            discovered = discover_relevant(catalog)
            source_health.append(source_state("Catalogue Open Data Clermont", True, detail=f"{len(catalog)} jeux lus, {len(discovered)} candidats mobilité/travaux" , url=f"{API_BASE}/catalog/datasets"))
        except Exception as exc:
            errors.append(f"catalog: {exc}")
            source_health.append(source_state("Catalogue Open Data Clermont", False, error=str(exc), url=f"{API_BASE}/catalog/datasets"))
    else:
        errors.append(f"api-health: {health.get('error')}")

    resolved_datasets = resolve_known_datasets(catalog) if catalog else dict(KNOWN_DATASETS)

    dataset_checks = []
    for role, did in resolved_datasets.items():
        if health["ok"]:
            chk = verify_dataset(did)
        else:
            chk = {"ok": False, "dataset_id": did, "title": did, "error": "API indisponible", "field_count": None, "data_processed": None, "latency_ms": None}
        chk["role"] = role
        dataset_checks.append(chk)
        source_health.append(source_state(f"Dataset Clermont · {role}", chk["ok"], detail=f"{chk.get('title') or did} · {chk.get('field_count') if chk.get('field_count') is not None else '—'} champs", error=chk.get("error"), url=f"{API_BASE}/catalog/datasets/{did}"))

    parking: list[dict[str, Any]] = []
    parking_status: dict[str, Any]
    if health["ok"]:
        parking, parking_status = fetch_parking(resolved_datasets["parking"])
    else:
        parking_status = {"ok": False, "dataset_id": resolved_datasets["parking"], "records": 0, "error": "API indisponible"}
    if not parking and isinstance(old.get("parking"), list):
        parking = old.get("parking", [])
        parking_status["fallback_last_known_good"] = bool(parking)
    source_health.append(source_state("Occupation parkings Métropole", parking_status.get("ok", False), detail=f"{parking_status.get('records', 0)} parcs lus" + (" · dernier état conservé" if parking_status.get("fallback_last_known_good") else ""), error=parking_status.get("error"), url=f"{API_BASE}/catalog/datasets/{resolved_datasets['parking']}/records"))

    api_works: list[dict[str, Any]] = []
    candidate_status: list[dict[str, Any]] = []
    if discovered and health["ok"]:
        api_works, candidate_status = api_context_candidates(discovered, set(resolved_datasets.values()))
    source_health.append(source_state("Détection automatique jeux travaux/mobilité", bool(discovered) and all(x.get("ok") for x in candidate_status if x), detail=f"{len(discovered)} candidat(s), {len(api_works)} événement(s) exploitable(s) via API", error=None if discovered else "Aucun jeu candidat détecté dans le catalogue", url=f"{API_BASE}/catalog/datasets"))

    page_works: list[dict[str, Any]] = []
    page_status: list[dict[str, Any]] = []
    for sector, url in WORK_PAGES.items():
        try:
            rows = works_for_sector(sector, url)
            page_works.extend(rows)
            page_status.append({"sector": sector, "ok": True, "records": len(rows), "error": None, "url": url})
            source_health.append(source_state(f"Travaux officiels · {sector}", True, detail=f"{len(rows)} élément(s)", url=url))
        except Exception as exc:
            page_status.append({"sector": sector, "ok": False, "records": 0, "error": compact_text(exc), "url": url})
            errors.append(f"works-page-{sector}: {exc}")
            source_health.append(source_state(f"Travaux officiels · {sector}", False, error=str(exc), url=url))

    works = merge_works(api_works, page_works)
    works_fresh = bool(works)
    if not works and isinstance(old.get("works"), list):
        works = old.get("works", [])
        errors.append("works: no fresh event, last-known-good retained")
    works = enrich_local_context(works, store_profile, geocode_cache, geocode_place=True)

    # Urban mobility and local activity context. Every source has an independent fallback.
    cvelo, cvelo_status = fetch_cvelo(resolved_datasets.get("cvelo_status", KNOWN_DATASETS["cvelo_status"]), resolved_datasets.get("cvelo_stations", KNOWN_DATASETS["cvelo_stations"])) if health["ok"] else ([], {"ok":False,"records":0,"error":"API indisponible"})
    if not cvelo and isinstance(old.get("cvelo"), list): cvelo=old.get("cvelo",[]); cvelo_status["fallback_last_known_good"]=bool(cvelo)
    source_health.append(source_state("C.vélo temps réel", bool(cvelo_status.get("ok")), detail=f"{cvelo_status.get('records',0)} station(s) · {cvelo_status.get('bikes_available') if cvelo_status.get('bikes_available') is not None else '—'} vélos disponibles", error=cvelo_status.get("error"), url=f"{API_BASE}/catalog/datasets/{resolved_datasets.get('cvelo_status',KNOWN_DATASETS['cvelo_status'])}/records"))

    bike_counts, bike_status = fetch_bike_counts(resolved_datasets.get("bike_counts", KNOWN_DATASETS["bike_counts"])) if health["ok"] else ([], {"ok":False,"records":0,"error":"API indisponible"})
    if not bike_counts and isinstance(old.get("bike_counts"), list): bike_counts=old.get("bike_counts",[]); bike_status["fallback_last_known_good"]=bool(bike_counts)
    source_health.append(source_state("Comptages vélo ZELT", bool(bike_status.get("ok")), detail=f"{bike_status.get('records',0)} mesure(s) publique(s)", error=bike_status.get("error"), url=f"{API_BASE}/catalog/datasets/{resolved_datasets.get('bike_counts',KNOWN_DATASETS['bike_counts'])}/records"))

    agenda, agenda_status = fetch_agenda()
    if not agenda and isinstance(old.get("agenda"), list): agenda=old.get("agenda",[]); agenda_status["fallback_last_known_good"]=bool(agenda)
    agenda = enrich_local_context(agenda, store_profile, geocode_cache)
    parking = enrich_local_context(parking, store_profile, geocode_cache)
    cvelo = enrich_local_context(cvelo, store_profile, geocode_cache)
    source_health.append(source_state("Agenda officiel Clermont-Ferrand", bool(agenda_status.get("ok")), detail=f"{agenda_status.get('records',0)} événement(s)", error=agenda_status.get("error"), url=f"{CITY_API_BASE}/catalog/datasets/{AGENDA_DATASET}/records"))

    t2c = fetch_t2c()
    if not t2c.get("ok") and isinstance(old.get("t2c"), dict):
        t2c={**old.get("t2c",{}),"fallback_last_known_good":True,"last_error":t2c.get("error")}
    source_health.append(source_state("T2C GTFS-RT", bool(t2c.get("ok")), detail=(f"{t2c.get('trip_updates') if t2c.get('trip_updates') is not None else 'flux'} mise(s) à jour trajet" + (f" · retard moyen {t2c.get('avg_delay_seconds')} s" if t2c.get('decoded') else " · flux reçu")), error=t2c.get("error"), url=T2C_GTFS_RT))

    now_for_events=iso_now()
    agenda_history=merge_event_history(old, agenda, now_for_events) if agenda_status.get("ok") else (old.get("agenda_history",[]) if isinstance(old.get("agenda_history"),list) else [])

    try:
        meteo = weather(safe_float(store_profile.get("lat")) or 45.7772, safe_float(store_profile.get("lon")) or 3.0870)
        source_health.append(source_state("Open-Meteo Clermont", True, detail=f"{len(meteo)} jours météo", url="https://api.open-meteo.com/"))
    except Exception as exc:
        errors.append(f"weather: {exc}")
        meteo = old.get("weather", []) if isinstance(old.get("weather"), list) else []
        source_health.append(source_state("Open-Meteo Clermont", False, detail="dernier historique conservé" if meteo else "", error=str(exc), url="https://api.open-meteo.com/"))

    old_health = {str(x.get("name")):x for x in old.get("source_health",[]) if isinstance(x,dict)} if isinstance(old,dict) else {}
    for row in source_health:
        if row.get("ok"):
            row["last_success_at"] = row.get("checked_at")
        else:
            row["last_success_at"] = old_health.get(str(row.get("name")),{}).get("last_success_at") or old_health.get(str(row.get("name")),{}).get("checked_at")

    api_ok = bool(health.get("ok"))
    fresh_work_sources = sum(1 for x in page_status if x.get("ok")) + (1 if api_works else 0)
    critical_ok = api_ok and any(x.get("ok") for x in dataset_checks if x.get("role") in ("roads", "parking"))
    status = "ok" if critical_ok and fresh_work_sources >= 2 and not errors else "partial"
    if not api_ok and not works and not meteo:
        status = "unavailable"

    now_iso = iso_now()
    if works_fresh:
        works_history = merge_work_history(old, works, now_iso)
        # Surface stable event ids on current events too.
        current_history = {x.get("event_id"): x for x in works_history if x.get("active")}
        works = [current_history.get(work_event_id(x), dict(x, event_id=work_event_id(x), active=True, first_seen=now_iso, last_seen=now_iso)) for x in works]
    else:
        works_history = old.get("works_history", []) if isinstance(old.get("works_history"), list) else []
        # A fallback must not pretend that old events were freshly observed.
        works = [dict(x, event_id=x.get("event_id") or work_event_id(x)) for x in works]

    payload = {
        "schema_version": 2,
        "build": VERSION,
        "generated_at": now_iso,
        "status": status,
        "privacy": "Public-data-only updater. No customer/TGM data is transmitted.",
        "store_profile": store_profile,
        "geocode_cache": geocode_cache,
        "clermont_api": {
            "base_url": API_BASE,
            "health": health,
            "resolved_dataset_ids": resolved_datasets,
            "known_datasets": dataset_checks,
            "discovered_relevant_datasets": discovered,
            "candidate_fetch_status": candidate_status,
        },
        "works": works,
        "works_history": works_history,
        "works_sources": {
            "api_events": len(api_works),
            "official_page_events": len(page_works),
            "page_status": page_status,
        },
        "parking": parking,
        "parking_status": parking_status,
        "agenda": agenda,
        "agenda_history": agenda_history,
        "agenda_status": agenda_status,
        "cvelo": cvelo,
        "cvelo_status": cvelo_status,
        "bike_counts": bike_counts,
        "bike_status": bike_status,
        "t2c": t2c,
        "weather": meteo,
        "source_health": source_health,
        "errors": [compact_text(x, 500) for x in errors],
        "sources": [API_CONSOLE, f"{CITY_API_BASE}/catalog/datasets/{AGENDA_DATASET}", T2C_GTFS_RT, *WORK_PAGES.values(), "https://api.open-meteo.com/"],
    }

    validation_errors = validate_payload(payload)
    if validation_errors:
        raise RuntimeError("Payload validation failed: " + "; ".join(validation_errors))

    # Transactional write.
    OUT.parent.mkdir(parents=True, exist_ok=True)
    TMP.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    json.loads(TMP.read_text("utf-8"))
    TMP.replace(OUT)
    update_history(payload)

    ok_sources = sum(1 for x in source_health if x.get("ok"))
    print(
        f"status={status} api_ok={api_ok} datasets={len(catalog)} relevant={len(discovered)} "
        f"works={len(works)} api_works={len(api_works)} parking={len(parking)} agenda={len(agenda)} "
        f"cvelo={len(cvelo)} bike={len(bike_counts)} t2c_ok={bool(t2c.get('ok'))} weather={len(meteo)} "
        f"sources_ok={ok_sources}/{len(source_health)} errors={len(errors)}"
    )


if __name__ == "__main__":
    main()
