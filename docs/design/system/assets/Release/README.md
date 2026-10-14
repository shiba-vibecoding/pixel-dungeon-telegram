Арт к релизу Shattered (v20).

| Файл | Размер | Что это |
| --- | --- | --- |
| `banner-whatsnew.png` | 104×56 | шапка большого окна «Что нового»: шесть героев у костра у входа, показ ×3 (312×168) |
| `trophy-pioneer.png`, `-32.png` | 16×16, 32×32 | памятный кубок «Первопроходец»: нефрит, ступенька-гравировка, золотой ободок и искра. В листах `trophies16.png` (кадр 8) и `trophies32.png` (кадр 5) |
| `trophy-pioneer-48.png` | 48×48 | эмблема для письма: кубок в лавровом венке и лента, показ ×2 (96 px) |
| `badge-bughunter.png` | 16×16 | значок «Охотник за багами»: щит, жук под лупой |
| `icon-offline.png`, `icon-report.png`, `icon-update.png` | 16×16 | нет связи, сообщить о проблеме, обновление (крутится шагами по 45°) |
| `github-social.png`, `github-header.png` | 160×80, 150×50 | сцена для превью ссылки и шапки README (×8); текст кладётся поверх |
| `social-preview-ru.png`, `header-ru.png`, `screens-ru.png`, `badge-*-ru.png` | готовые | оформление GitHub; английские — в `docs/github/` архива |

Сцена собирается скриптом `tools/art/banner.py` из тех же частей, что Привал: `scene(w, h, cxf=…)` — ширина, высота, где стоит костёр.


**v24:** `icon-update.png` — значок CHANGES из `icons.png` Shattered (зелёная и красная стрелки); `banner-whatsnew.png` — тот же костёр, герои с листов Shattered.
