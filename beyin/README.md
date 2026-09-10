# BEYİN — v1

Instagram Reels için kişisel sürtünme aracı. Tek dosya (`index.html`), framework yok,
sunucu yok, hesap yok. Tüm veri telefonun içinde (`localStorage`) kalır.

---

## 1. Ne yapıyor

Instagram'ı açtığında önce bu sayfa çıkar. Sayfada:

- **Beyin** — sağlığına göre rengi, çürük lekeleri, yüz ifadesi ve hareketi değişen bir karakter.
- **Acı gerçek** — yaşın ve günlük ekran saatinden hesaplanmış tek bir büyük rakam. Her açılışta başkası.
- **Vazgeçtim** — beyin +8 iyileşir, ekranda telefon yerine yapılacak küçük bir görev çıkar.
- **Yine de gir** — geri sayım bitmeden basılamaz. Basınca beyin -7 ve `InstaGec` kısayolu Instagram'ı açar.

### Puan tablosu

| Olay | Beyin sağlığı |
| --- | --- |
| Başlangıç | 60 |
| Sayfa açılışı | −3 (60 sn içindeki yenilemeler sayılmaz) |
| "Yine de gir" | −7 |
| "Vazgeçtim" | +8 |
| Yeni gün | +5 |

**"Yine de gir" kilidi:** 10 sn + o gün yaptığın her giriş için +5 sn, en fazla 60 sn.

**Durum etiketleri:** Taze (78+) · Yorgun (55+) · Bulanık (35+) · Çürüyor (15+) · Zombi (15 altı).
50 altında damlalar, 40 altında sallanma, 30 altında sinekler başlar.

---

## 2. Yayınlama

Sayfanın bir adresi olması gerekiyor, çünkü Kısayollar onu URL olarak açacak.
İkisinden birini seç — ikisi de ücretsiz.

### A) Netlify Drop (en hızlı, 1 dakika, hesap bile şart değil)

1. Bilgisayarda `beyin` klasörünü hazırla (içinde sadece `index.html` olması yeterli).
2. Safari/Chrome'da **https://app.netlify.com/drop** adresine git.
3. Klasörü sayfanın ortasına sürükle bırak.
4. Netlify sana `https://rastgele-isim-123.netlify.app` gibi bir adres verir. **Bu adresi not al.**
5. (İsteğe bağlı) Ücretsiz hesap açıp *Site configuration → Change site name* ile adı
   `beyin-mert` gibi bir şeye çevir.

Güncelleme: değiştirdiğin klasörü aynı yere tekrar sürükle (hesap açtıysan *Deploys* sekmesine).

### B) GitHub Pages (repo içinde kalsın istersen)

Bu dosya zaten `beyin/` klasöründe. Repo'da:

1. GitHub'da repo → **Settings → Pages**.
2. *Source*: **Deploy from a branch**.
3. *Branch*: yayınlamak istediğin dal + klasör olarak **`/ (root)`** seç, **Save**.
4. Birkaç dakika sonra adres: `https://<kullanıcı-adın>.github.io/<repo-adı>/beyin/`

> Not: Repo private ise GitHub Pages ücretsiz planda yayınlamaz. O durumda Netlify Drop kullan
> ya da `index.html`'i ayrı bir public repo'ya koy.

**Sayfayı telefonda bir kez aç ve çalıştığını gör. Adresi kopyala — sonraki adımda lazım.**

---

## 3. iPhone kurulumu

İki parça var: **InstaGec** adında bir kısayol, bir de **otomasyon**.
Döngüyü (sayfa → Instagram → sayfa → …) kıran şey bu ikilinin birlikte çalışması.

Mantık şu:

- `InstaGec` kısayolu önce `beyin_gecis.txt` adında bir **bayrak dosyası** yazar, sonra Instagram'ı açar.
- Otomasyon, Instagram her açıldığında çalışır: **dosya varsa** onu siler ve hiçbir şey yapmaz
  (demek ki oraya sayfadan bilerek geldin). **Dosya yoksa** sayfayı açar.

### 3.1 Klasörü hazırla

1. **Dosyalar** uygulamasını aç → **Gözat** → **iCloud Drive** (yoksa **Bu iPhone'da**).
2. Sağ üstten yeni klasör oluştur, adını **Beyin** koy.

### 3.2 "InstaGec" kısayolunu oluştur

1. **Kısayollar** uygulaması → **Kısayollar** sekmesi → sağ üstte **+**.
2. Sağ üstteki ok/ayar simgesine dokunup **Yeniden Adlandır** de, adını tam olarak
   **InstaGec** yap. (Sayfadaki düğme bu ismi çağırıyor — harfi harfine aynı olmalı.)
3. Arama kutusuna **Metin** yaz, **Metin** eylemini ekle. İçine tek harf yeter: `1`
4. Arama kutusuna **Dosya Kaydet** yaz, **Dosya Kaydet** eylemini ekle.
   - Eylemin üstündeki **Kaydetme yerini sor** yazan kısma dokun ve **kapat**.
   - **Servis/Klasör** olarak az önce açtığın **Beyin** klasörünü seç.
   - Eylemin altındaki oku açıp **Dosya Adı** alanına **beyin_gecis.txt** yaz.
   - Varsa **Üzerine Yaz** / **Sorma** seçeneğini aç.
5. Arama kutusuna **Uygulamayı Aç** yaz, **Uygulamayı Aç** eylemini ekle ve
   uygulama olarak **Instagram**'ı seç.
6. Sağ üstten **Bitti**.

Sıralama şöyle olmalı:

```
1. Metin: 1
2. Dosya Kaydet  →  Beyin/beyin_gecis.txt   (üzerine yaz, sorma)
3. Uygulamayı Aç →  Instagram
```

Kısayolu bir kez elle çalıştır: Instagram açılmalı ve **Beyin** klasöründe
`beyin_gecis.txt` dosyası görünmeli. Dosyayı elle sil.

### 3.3 Otomasyonu oluştur

1. **Kısayollar** → alttan **Otomasyon** sekmesi → sağ üstte **+**
   (veya **Yeni Otomasyon**).
2. Listeden **Uygulama**'yı seç.
3. **Uygulama** satırına dokun → **Seç** → **Instagram** → **Bitti**.
4. **Açıldığında** işaretli olsun, **Kapatıldığında** işaretli olmasın.
5. Altta **Hemen Çalıştır**'ı seç (**Çalıştırmadan Önce Sor** kapalı olmalı).
   Varsa **Bildirimde Bulunma**'yı da aç.
6. **İleri** → **Boş Otomasyon Oluştur** (ya da **Yeni Boş Otomasyon**).
7. Şu eylemleri sırayla ekle:

   **a. Dosya Al**
   - Arama kutusuna **Dosya Al** yaz, ekle.
   - Klasör/yol olarak **Beyin** klasörünü ve **beyin_gecis.txt** dosyasını göster.
   - Eylemin altındaki oku aç, **Bulunamazsa Hata Ver** seçeneğini **kapat**.
     (Bu şart — dosya yokken otomasyon patlamasın diye.)

   **b. Eğer**
   - **Eğer** eylemini ekle.
   - Koşul: **Dosya Al** çıktısı → **değeri var** (İngilizce'de *has any value*).

   **Eğer bloğunun içine (dosya VARSA):**
   - **Dosyayı Sil** eylemini ekle, girdisi **Dosya Al** çıktısı olsun.
   - Eylemin altındaki oku açıp **Silmeden Önce Sor**'u **kapat**.

   **Aksi halde bloğunun içine (dosya YOKSA):**
   - **URL** eylemini ekle, içine yayınladığın adresi yaz
     (örn. `https://beyin-mert.netlify.app`).
   - **URL'leri Aç** eylemini ekle (girdisi yukarıdaki URL olur).

8. **Bitti**.

Otomasyon şöyle görünmeli:

```
Dosya Al: Beyin/beyin_gecis.txt   (bulunamazsa hata verme: KAPALI)
Eğer  [Dosya]  değeri var
    Dosyayı Sil  (sormadan)
Aksi halde
    URL: https://…senin-adresin…
    URL'leri Aç
Bitti
```

### 3.4 Test

1. Ana ekrandan **Instagram**'a dokun → **Beyin sayfası** açılmalı.
2. **Yine de gir**'e bas (geri sayım bitince) → Instagram açılmalı.
3. Instagram'dan çık, tekrar Instagram'a dokun → yine Beyin sayfası açılmalı.
4. Sayfayı ana ekrana eklemek istersen: Safari'de sayfayı aç → **Paylaş** →
   **Ana Ekrana Ekle**. Tam ekran çalışır, adres çubuğu görünmez.

### Takılırsan

| Sorun | Bakılacak yer |
| --- | --- |
| "Yine de gir" hiçbir şey yapmıyor | Kısayolun adı tam olarak `InstaGec` mi? Türkçe karakter/boşluk olmamalı. |
| Instagram'a geçince sayfa tekrar açılıyor (döngü) | Dosya Kaydet ile Dosya Al **aynı klasörü ve aynı dosya adını** göstermiyor. |
| Otomasyon hiç çalışmıyor | Otomasyonda **Hemen Çalıştır** açık ve **Çalıştırmadan Önce Sor** kapalı olmalı. |
| Instagram'a hiç giremiyorum | **Beyin** klasöründeki `beyin_gecis.txt` dosyasını elle sil. |
| Sayı hep aynı | Ayarlar'dan **yaş** ve **günlük ortalama saat** değerlerini gir. |

---

## 4. Ayarlar

Sayfanın altındaki **Ayarlar**'dan:

- **Yaş** — acı gerçeklerin hesabı buradan yapılıyor.
- **Günlük ortalama ekran saati** — varsayılan 8. Ekran Süresi ekranındaki gerçek rakamı yaz.
- **Her şeyi sıfırla** — beyin sağlığı ve tüm istatistikler silinir.

---

## 5. Yeni "acı gerçek" ekleme

`index.html` içinde `GERCEKLER` dizisini bul. Her madde bir fonksiyon; içeriye
`{age, hours, visits, enters, quits, totalQuits}` gelir, geriye üç alan döner:

```js
function(c){
  var x = c.hours * 30;
  return {
    big: Math.round(x),          // büyük kırmızı rakam
    unit: "saat / ay",           // rakamın yanındaki küçük yazı
    text: "Bir ayda bu kadar."   // altındaki cümle
  };
}
```

Diziye ekle, kaydet, yeniden yayınla. Sayfa gerçekleri **torba usulü** gösterir:
hepsi bir kez çıkmadan aynısı tekrar etmez.

Küçük görevleri de aynı dosyadaki **`GOREVLER`** dizisinden
düz metin olarak ekleyip çıkarabilirsin.

Puanları değiştirmek istersen dosyanın başındaki
`START_HEALTH`, `COST_VISIT`, `COST_ENTER`, `GAIN_QUIT`, `GAIN_NEW_DAY`,
`LOCK_BASE`, `LOCK_PER_ENTER`, `LOCK_MAX` sabitleri tek yerde duruyor.

---

## 6. Sonraki sürüm için (v1'de yok)

- "Kapandığında" otomasyonuyla gerçek süre takibi
- Seri (streak) sayacı
- Uygulamalar arası geçişlerde 10 dk bekleme seçeneği
