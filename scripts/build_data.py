import json, os, time, urllib.request, urllib.parse
from datetime import datetime, timezone, date

FETCH_FROM = date(2023, 6, 1)
UA = {"User-Agent": "Mozilla/5.0"}
INDICES = [
    ("sh", "上证综指", "A股", "qq", "sh000001"),
    ("sz", "深证成指", "A股", "qq", "sz399001"),
    ("hs300", "沪深300", "A股", "qq", "sh000300"),
    ("cyb", "创业板指", "A股", "qq", "sz399006"),
    ("kc50", "科创50", "A股", "qq", "sh000688"),
    ("dji", "道琼斯", "美国", "yh", "^DJI"),
    ("ixic", "纳斯达克", "美国", "yh", "^IXIC"),
    ("n225", "日经225", "日本", "yh", "^N225"),
    ("ks11", "KOSPI", "韩国", "yh", "^KS11"),
    ("hsi", "恒生指数", "香港", "yh", "^HSI"),
]

def get(url):
    for attempt in range(5):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception:
            if attempt == 4: raise
            time.sleep(10 * (attempt + 1))

def tencent(code):
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,{FETCH_FROM.isoformat()},2099-12-31,2000,"
    return [[d, float(o), float(h), float(l), float(c), round(float(v))]
            for d, o, c, h, l, v, *_ in get(url)["data"][code]["day"]]

def yahoo(sym):
    p1 = int(datetime(FETCH_FROM.year, FETCH_FROM.month, FETCH_FROM.day, tzinfo=timezone.utc).timestamp())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?period1={p1}&period2={int(time.time())}&interval=1d"
    r = get(url)["chart"]["result"][0]
    off, q = r["meta"]["gmtoffset"], r["indicators"]["quote"][0]
    rows = {}
    for i, ts in enumerate(r["timestamp"]):
        vals = [q[k][i] for k in ("open", "high", "low", "close")]
        if None in vals: continue
        d = datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d")
        rows[d] = [d] + [round(x, 2) for x in vals] + [q["volume"][i] or 0]
    return sorted(rows.values())

out = []
for key, name, market, src, code in INDICES:
    cache = f"scripts/.cache/{key}.json"
    if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < 3600:
        rows = json.load(open(cache))
    else:
        rows = tencent(code) if src == "qq" else yahoo(code)
        os.makedirs("scripts/.cache", exist_ok=True)
        json.dump(rows, open(cache, "w"))
        time.sleep(3)
    out.append({"key": key, "name": name, "market": market, "code": code[2:] if src == "qq" else code.lstrip("^"), "volUnit": "手" if src == "qq" else "", "rows": rows})
    print(f"{name:6s} {len(rows)} 行 {rows[0][0]} ~ {rows[-1][0]}")

last = max(i["rows"][-1][0] for i in out)
ld = date.fromisoformat(last)
display_start = ld.replace(year=ld.year - 2).isoformat()
json.dump({"updated": last, "displayStart": display_start, "indices": out},
          open("public/data.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("updated", last, "displayStart", display_start)
