# Orbit - Claude Code ile geliştirme rehberi

**Bu ZIP dosyası hazır bir uygulama değil; Claude Code'un gerçek Orbit uygulamasını uçtan uca geliştirebilmesi için hazırlanmış proje belgeleri, Opus yönergeleri, Sonnet alt ajanları, örnek tasarımlar ve sentetik test verileridir.**

## Ne geliştiriyoruz?

Orbit, Claude Code'un bilgisayarında saklanan yerel oturum kayıtlarını kullanarak projeleri, token tüketimini, alt ajan görevlerini ve API fiyatlarına göre **tahmini kullanım değerini** gösteren, premium tasarımlı ve açık kaynak bir dashboard olacak.

**Önemli:** Claude Pro/Max aboneliğinde görünen USD karşılığı gerçek ödeme tutarı değildir. Ayrıca hesap genelindeki geçmiş, bilgisayarda artık mevcut olmayan kayıtlardan geri getirilemez.

## Mac'te başlat

1. ZIP dosyasını açıp `orbit-claude-launchpad` klasörünü örneğin `~/Developer` içine taşı.
2. Cursor veya Terminal'de bu klasörü aç.
3. Aşağıdaki komutları çalıştır:

```bash
cd ~/Developer/orbit-claude-launchpad
claude --model opus
```

4. Ana Opus oturumuna `prompts/OPUS_KICKOFF.md` dosyasının **tamamını** ilk mesaj olarak yapıştır. Mac'te panoya almak için, ayrı bir terminalde `pbcopy < prompts/OPUS_KICKOFF.md` kullanabilirsin.
5. Opus `CLAUDE.md` ve `docs/` belgelerini okuyacak; `.claude/agents/` içindeki Sonnet ajanlarına iş paylaştıracak.
6. Her aşamanın kodunu, testlerini, ekran görüntülerini ve eksiklerini Opus'tan istemene gerek yok: bunu kendisi raporlamak zorunda.
7. Uzun oturum biterse yeni bir Opus oturumu açıp `prompts/OPUS_CONTINUE.md` dosyasını gönder.
8. GitHub yayınından önce `prompts/OPUS_RELEASE_REVIEW.md` ile bağımsız son denetim yaptır. Kodları herkese açmadan önce senin onayın istenecek.

## Belgeleri nerede bulacaksın?

- `CLAUDE.md` - Opus'un uyacağı kurallar ve iş dağıtımı.
- `.claude/agents/` - **8 adet Sonnet** ajan tanımı.
- `docs/PRD.md` - tüm ürün istekleri.
- `docs/DATA_INGESTION.md` - Claude Code'un yerel kayıtları ve alt ajan eşleştirmesi.
- `docs/COST_ENGINE.md` - maliyet formülleri ve belirsizlik kuralları.
- `docs/DESIGN_SYSTEM.md` ve `docs/SCREENS.md` - özgün Orbit arayüzü.
- `design/references/` - önceden onayladığın örnek ekranlar.
- `docs/ROADMAP.md` - fazlar, teslimat ve kabul kriterleri.
- `fixtures/` - gerçek kullanıcı verisi içermeyen test kayıtları.

## Geliştirme sırasındaki üç kural

1. **Opus yönetsin, Sonnet kodlasın.** Büyük kodlama işleri Sonnet ajanlarına verilecek.
2. **Gerçek veriler gizli kalacak.** Onayın olmadan `~/.claude` oturum içeriği incelemeye açılmayacak veya GitHub'a yüklenmeyecek.
3. **Sahte özellik olmayacak.** İlk sürüm ajanları gözlemler; başka bir Claude oturumunu durdurma veya görev atama işlemi yapmaz.

Kodlama bitince uygulamayı kullanıcının Mac'inde `localhost` üzerinden açıp bütün kaynak kodlarını GitHub'da paylaşacağız. **Bu paketin hazırlanması GitHub'a yayın yapıldığı anlamına gelmez.**
