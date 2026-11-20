# AGENTS.md – instruktioner till AI-verktyg i det här repot

Utsikt (Seat View) är en statisk webbsida: en enda `index.html` byggd av `src/`. Den visar en uppskattad 3D-modell av en arena i Göteborg och utsikten från vald plats.

## Så arbetar du här
- Språk: UI på engelska, dokumentation på svenska.
- Bygg: `npm install` och `bash build.sh`. Resultatet är `index.html`. Redigera aldrig `index.html` för hand, ändra i `src/`.
- Ingen server, ingen databas, inga API-anrop. Enda externa hämtningen är typsnitt från Google Fonts. Sidan måste fungera som en enda fil.
- Prestanda: håll antalet draw calls lågt (publiken är instansierad). Testa att mobil fortfarande går smidigt.

## Regler (stoppsignaler)
- **Inga nycklar, lösenord, tokens eller personuppgifter** i koden, i commits eller i exempel. Om du behöver en nyckel: stanna och fråga.
- **Inga riktiga biljettdata.** Platserna är en modell. Sidan ska alltid säga att den inte är officiell platsdata.
- Lägg inte till spårning, analys eller externa script utan att fråga.
- Ändra inte färger så att kontrasten understiger WCAG AA (4,5:1 för text, 3:1 för stora komponenter). Räkna om kontrasten efter varje färgändring.
- Hitta inte på fakta om arenan (sektioner, entréer). Ange osäkerhet i stället.
- Använd inte varumärken eller logotyper som inte är mina.

## Definition av klart
1. Bygget går igenom utan fel.
2. Sidan laddar utan fel i konsolen, på dator och mobil (390 px bred).
3. Kontrast kontrollerad efter varje färgändring.
4. README och beslutsloggen är uppdaterade.
