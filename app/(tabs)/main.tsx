// app/(tabs)/main.tsx
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import * as Print from "expo-print";

import {
    collection,
    doc,
    query as fsQuery,
    onSnapshot,
    orderBy,
    runTransaction,
    serverTimestamp,
} from "firebase/firestore";

import { db } from "../../src/firebase";

type Mode = "serial" | "barcode";

type ProductDoc = {
  id: string;
  name: string;
  sku?: string;
  serialNumber?: string;
  barcode?: string;

  price: number;
  purchasePrice?: number;
  stockQty?: number;

  discountPercent: number;
  active: boolean;

  imageUrl?: string;
  createdAtMs?: number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

const calcDiscount = (price: number, discountPercent: number) => {
  const p = Number.isFinite(price) ? price : 0;
  const d = clamp(Number.isFinite(discountPercent) ? discountPercent : 0, 0, 100);
  const discountAmount = round2((p * d) / 100);
  const finalPrice = round2(p - discountAmount);
  return { discountAmount, finalPrice };
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

function esc(s: string) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeInvoiceHtml(args: {
  invoiceNo: string;
  dateStr: string;
  itemName: string;
  sku?: string;
  barcode?: string;
  serial?: string;
  unitPrice: number;
  total: number;
}) {
  const { invoiceNo, dateStr, itemName, sku, barcode, serial, unitPrice, total } = args;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, Arial; padding: 24px; color:#111; }
    .top { display:flex; justify-content:space-between; align-items:flex-start; }
    .h1 { font-size: 20px; font-weight: 800; margin:0; }
    .muted { color:#555; font-size: 12px; margin-top:6px; }
    .box { margin-top:16px; border:1px solid #ddd; border-radius:12px; padding:12px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th, td { border-bottom:1px solid #eee; padding:10px 6px; font-size: 13px; text-align:left; }
    th { font-weight:800; background:#fafafa; }
    .right { text-align:right; }
    .total { font-size:16px; font-weight:900; }
    .foot { margin-top:18px; font-size:12px; color:#666; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <p class="h1">Faturë</p>
      <div class="muted">Nr: ${esc(invoiceNo)}<br/>Data: ${esc(dateStr)}</div>
    </div>
    <div class="muted" style="text-align:right;">
      POS / Workers
    </div>
  </div>

  <div class="box">
    <div style="font-weight:800; margin-bottom:6px;">Produkti</div>
    <div>${esc(itemName)}</div>
    <div class="muted">
      ${sku ? `SKU: ${esc(sku)}<br/>` : ""}
      ${serial ? `Nr. Serik: ${esc(serial)}<br/>` : ""}
      ${barcode ? `Barkod: ${esc(barcode)}<br/>` : ""}
    </div>

    <table>
      <thead>
        <tr>
          <th>Artikulli</th>
          <th class="right">Sasia</th>
          <th class="right">Cmimi</th>
          <th class="right">Totali</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(itemName)}</td>
          <td class="right">1</td>
          <td class="right">€${unitPrice.toFixed(2)}</td>
          <td class="right">€${total.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div style="display:flex; justify-content:flex-end; margin-top:12px;">
      <div class="total">TOTAL: €${total.toFixed(2)}</div>
    </div>
  </div>

  <div class="foot">Faleminderit!</div>

  <script>
    // Auto-open print dialog on web
    window.addEventListener('load', () => {
      try { window.print(); } catch(e) {}
    });
  </script>
</body>
</html>`;
}

export default function Main() {
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? "light"];

  // Always dark look
  const bg = "#0B0F14";
  const surface = "#111827";
  const surface2 = "#0F172A";
  const stroke = "rgba(255,255,255,0.10)";
  const text = "#E5E7EB";
  const muted = "rgba(229,231,235,0.70)";
  const subtle = "rgba(229,231,235,0.50)";
  const tint = theme.tint;

  // buttons
  const sellGreen = "#22C55E";
  const cancelRed = "#EF4444";

  const [mode, setMode] = useState<Mode>("barcode");
  const [queryText, setQueryText] = useState("");

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductDoc[]>([]);

  // popup
  const [selected, setSelected] = useState<ProductDoc | null>(null);
  const [selling, setSelling] = useState(false);

  useEffect(() => {
    const q = fsQuery(collection(db, "products"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ProductDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const createdAtMs =
            data?.createdAt?.toMillis?.() ??
            (typeof data?.createdAtMs === "number" ? data.createdAtMs : undefined);

          return {
            id: d.id,
            name: String(data?.name ?? ""),
            sku: data?.sku ? String(data.sku) : undefined,
            serialNumber: data?.serialNumber ? String(data.serialNumber) : undefined,
            barcode: data?.barcode ? String(data.barcode) : undefined,
            price: Number(data?.price ?? 0),
            purchasePrice: typeof data?.purchasePrice === "number" ? Number(data.purchasePrice) : undefined,
            stockQty: typeof data?.stockQty === "number" ? Number(data.stockQty) : 0,
            discountPercent: Number(data?.discountPercent ?? 0),
            active: Boolean(data?.active ?? true),
            imageUrl: data?.imageUrl ? String(data.imageUrl) : undefined,
            createdAtMs,
          };
        });

        setProducts(list);
        setLoading(false);
      },
      (err) => {
        console.log(err);
        Alert.alert("Gabim", "S’u lexuan produktet nga Firestore.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return [];

    return products.filter((p) => {
      const name = (p.name ?? "").toLowerCase();
      const sku = (p.sku ?? "").toLowerCase();
      const serial = (p.serialNumber ?? "").toLowerCase();
      const barcode = (p.barcode ?? "").toLowerCase();

      if (mode === "serial") {
        return serial.includes(q) || sku.includes(q) || name.includes(q) || barcode.includes(q);
      }
      return barcode.includes(q) || sku.includes(q) || name.includes(q) || serial.includes(q);
    });
  }, [queryText, products, mode]);

  const subtitle =
    mode === "barcode" ? "Shkruaj ose skano barkodin e produktit" : "Shkruaj numrin serik të produktit";

  const closePopup = () => {
    if (selling) return;
    setSelected(null);
  };

  const printInvoiceNow = async (html: string) => {
    // ✅ iOS/Android: opens native print dialog immediately
    if (Platform.OS !== "web") {
      await Print.printAsync({ html });
      return;
    }

    // ✅ Web fallback: open new tab and auto-print (script in HTML calls window.print())
    try {
      if (typeof window !== "undefined") {
        const w = window.open("", "_blank");
        if (!w) {
          Alert.alert("Print", "Nuk u lejua me hap tab të ri. Lejo popups në browser.");
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
      } else {
        Alert.alert("Print", "Print në web nuk u gjet window.");
      }
    } catch {
      Alert.alert("Print", "S’u hap print dialog në web.");
    }
  };

  const doSell = async () => {
    const p = selected;
    if (!p) return;
    if (selling) return;

    const currentStock = Number(p.stockQty ?? 0);
    if (!p.active) {
      Alert.alert("S’lejohet", "Ky produkt është Off.");
      return;
    }
    if (currentStock <= 0) {
      Alert.alert("S’ka stok", "Stoku është 0. S’mund të shitet.");
      return;
    }

    setSelling(true);
    try {
      const { finalPrice } = calcDiscount(p.price ?? 0, p.discountPercent ?? 0);
      const unitPrice = (p.discountPercent ?? 0) > 0 ? finalPrice : p.price ?? 0;
      const unitPurchase = Number(p.purchasePrice ?? 0);

      const profit = round2((unitPrice - unitPurchase) * 1);
      const total = round2(unitPrice * 1);

      const now = new Date();
      const invNo = `INV-${Date.now()}`;
      const dateStr = now.toLocaleString();

      await runTransaction(db, async (tx) => {
        const pref = doc(db, "products", p.id);
        const snap = await tx.get(pref);
        if (!snap.exists()) throw new Error("Produkti nuk ekziston.");

        const data = snap.data() as any;
        const stock = Number(data?.stockQty ?? 0);

        if (stock <= 0) {
          throw new Error("Stoku u bë 0 (dikush tjetër shiti).");
        }

        tx.update(pref, {
          stockQty: stock - 1,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        });

        const saleRef = doc(collection(db, "sales"));
        tx.set(saleRef, {
          invoiceNo: invNo,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          dayKey: dayKey(now),
          monthKey: monthKey(now),
          items: [
            {
              productId: p.id,
              name: p.name,
              sku: p.sku ?? null,
              barcode: p.barcode ?? null,
              serialNumber: p.serialNumber ?? null,
              qty: 1,
              unitPrice: round2(unitPrice),
              unitPurchasePrice: round2(unitPurchase),
              discountPercent: round2(p.discountPercent ?? 0),
              lineTotal: round2(total),
              lineProfit: round2(profit),
            },
          ],
          total: round2(total),
          profitTotal: round2(profit),
        });
      });

      const html = makeInvoiceHtml({
        invoiceNo: invNo,
        dateStr,
        itemName: p.name,
        sku: p.sku,
        barcode: p.barcode,
        serial: p.serialNumber,
        unitPrice,
        total,
      });

      // ✅ PRINT IMMEDIATELY after sell
      await printInvoiceNow(html);

      setQueryText("");
      setSelected(null);
    } catch (e: any) {
      console.log("SELL ERROR:", e);
      Alert.alert("Gabim", e?.message ?? "S’u kry shitja.");
    } finally {
      setSelling(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: text }]}>Main</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {loading ? "Duke u ngarku..." : subtitle}
            </Text>
          </View>

          <View style={styles.pillsRow}>
            <Pill
              active={mode === "barcode"}
              label="Barkod"
              icon="barcode.viewfinder"
              onPress={() => setMode("barcode")}
              activeBg={tint}
              inactiveBg={surface}
              activeText="#0B0F14"
              inactiveText={text}
              border={stroke}
            />
            <Pill
              active={mode === "serial"}
              label="Nr. Serik"
              icon="number.circle"
              onPress={() => setMode("serial")}
              activeBg={tint}
              inactiveBg={surface}
              activeText="#0B0F14"
              inactiveText={text}
              border={stroke}
            />
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchWrap, { backgroundColor: surface, borderColor: stroke }]}>
          <View style={styles.searchIcon}>
            <IconSymbol size={20} name="magnifyingglass" color={subtle} />
          </View>

          <TextInput
            value={queryText}
            onChangeText={setQueryText}
            placeholder={mode === "barcode" ? "p.sh. 8600123456789" : "p.sh. SN-270-2026-000184"}
            placeholderTextColor={subtle}
            style={[styles.searchInput, { color: text }]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={mode === "barcode" ? "numeric" : "default"}
            returnKeyType="search"
          />

          {queryText.length > 0 ? (
            <Pressable
              onPress={() => setQueryText("")}
              hitSlop={12}
              android_ripple={{ color: "rgba(255,255,255,0.10)", borderless: true }}
              style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <IconSymbol size={20} name="xmark.circle.fill" color={tint} />
            </Pressable>
          ) : null}
        </View>

        {/* Results header */}
        <View style={styles.resultsHeader}>
          <Text style={[styles.resultsTitle, { color: text }]}>Rezultatet</Text>
          <View style={[styles.countPill, { backgroundColor: surface, borderColor: stroke }]}>
            <Text style={[styles.resultsCount, { color: queryText.trim() ? text : subtle }]}>
              {queryText.trim()
                ? `${filtered.length} found`
                : loading
                ? "loading"
                : `${products.length} total`}
            </Text>
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, filtered.length === 0 ? { flexGrow: 1 } : null]}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelected(item)} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
              <ProductRow product={item} text={text} muted={muted} surface={surface} surface2={surface2} border={stroke} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState hasQuery={queryText.trim().length > 0} tint={tint} muted={muted} loading={loading} />
          }
        />

        {/* POPUP */}
        <Modal transparent visible={!!selected} animationType="fade" onRequestClose={closePopup}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.popupCard, { backgroundColor: surface, borderColor: stroke }]}>
              <View style={styles.popupTopBig}>
                {/* Left: BIG IMAGE */}
                <View style={[styles.popupImageBig, { backgroundColor: surface2, borderColor: stroke }]}>
                  {selected?.imageUrl ? (
                    <Image source={{ uri: selected.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  ) : (
                    <View style={styles.imgFallback}>
                      <IconSymbol size={34} name="photo" color={muted} />
                      <Text style={{ color: muted, fontWeight: "900", marginTop: 8 }}>NO IMAGE</Text>
                    </View>
                  )}

                  {/* badges on image */}
                  <View style={styles.badgesOnImage}>
                    {!selected?.active ? (
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: "rgba(239,68,68,0.18)", borderColor: "rgba(239,68,68,0.35)" },
                        ]}
                      >
                        <Text style={[styles.badgeText, { color: "#FCA5A5" }]}>OFF</Text>
                      </View>
                    ) : null}

                    {(selected?.discountPercent ?? 0) > 0 ? (
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: "rgba(245,158,11,0.18)", borderColor: "rgba(245,158,11,0.35)" },
                        ]}
                      >
                        <Text style={[styles.badgeText, { color: "#FCD34D" }]}>-{round2(selected!.discountPercent)}%</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Right: details */}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.popupTitle, { color: text }]} numberOfLines={2}>
                    {selected?.name ?? ""}
                  </Text>

                  <View style={{ marginTop: 10, gap: 6 }}>
                    {!!selected?.sku && <InfoLine label="SKU" value={selected.sku} text={text} muted={muted} />}
                    {!!selected?.serialNumber && (
                      <InfoLine label="Nr. Serik" value={selected.serialNumber} text={text} muted={muted} />
                    )}
                    {!!selected?.barcode && <InfoLine label="Barkod" value={selected.barcode} text={text} muted={muted} />}
                    <InfoLine
                      label="Stok"
                      value={String(Number(selected?.stockQty ?? 0))}
                      text={text}
                      muted={muted}
                      strong
                    />
                  </View>

                  {/* Price box */}
                  <View style={[styles.priceBox, { backgroundColor: surface2, borderColor: stroke }]}>
                    {(() => {
                      const p = selected;
                      if (!p) return null;
                      const hasDisc = (p.discountPercent ?? 0) > 0;
                      const { finalPrice } = calcDiscount(p.price ?? 0, p.discountPercent ?? 0);
                      const unit = hasDisc ? finalPrice : p.price ?? 0;

                      return (
                        <>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                            <Text style={[styles.priceLabel, { color: muted }]}>Final</Text>
                            <Text style={[styles.priceFinal, { color: text }]}>€{unit.toFixed(2)}</Text>
                          </View>

                          {hasDisc ? (
                            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                              <Text style={[styles.priceSmall, { color: muted }]}>Origjinal</Text>
                              <Text style={[styles.priceOld, { color: muted }]}>€{Number(p.price ?? 0).toFixed(2)}</Text>
                            </View>
                          ) : (
                            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                              <Text style={[styles.priceSmall, { color: muted }]}>Status</Text>
                              <Text style={[styles.priceSmall, { color: text, fontWeight: "900" }]}>Pa zbritje</Text>
                            </View>
                          )}
                        </>
                      );
                    })()}
                  </View>
                </View>
              </View>

              <View style={styles.popupActions}>
                <Pressable
                  onPress={doSell}
                  disabled={selling}
                  style={({ pressed }) => [
                    styles.sellBtn,
                    { backgroundColor: sellGreen, opacity: pressed ? 0.92 : 1 },
                    selling ? { opacity: 0.6 } : null,
                  ]}
                >
                  {selling ? <ActivityIndicator /> : <Text style={[styles.sellText, { color: "#04110A" }]}>SHIT</Text>}
                </Pressable>

                <Pressable
                  onPress={closePopup}
                  disabled={selling}
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    { backgroundColor: cancelRed, opacity: pressed ? 0.92 : 1 },
                    selling ? { opacity: 0.6 } : null,
                  ]}
                >
                  <Text style={[styles.cancelText, { color: "#140405" }]}>ANULO</Text>
                </Pressable>
              </View>

              <Text style={[styles.popupHint, { color: subtle }]}>SHIT → hap print dialog + ul stokun për 1.</Text>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

/* ---------------- UI components ---------------- */

function Pill({
  active,
  label,
  icon,
  onPress,
  activeBg,
  inactiveBg,
  activeText,
  inactiveText,
  border,
}: {
  active: boolean;
  label: string;
  icon: any;
  onPress: () => void;
  activeBg: string;
  inactiveBg: string;
  activeText: string;
  inactiveText: string;
  border: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "rgba(255,255,255,0.12)" }}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: active ? activeBg : inactiveBg,
          borderColor: active ? "transparent" : border,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
      hitSlop={6}
    >
      <IconSymbol size={18} name={icon} color={active ? activeText : inactiveText} />
      <Text style={[styles.pillText, { color: active ? activeText : inactiveText }]}>{label}</Text>
    </Pressable>
  );
}

function ProductRow({
  product,
  text,
  muted,
  surface,
  surface2,
  border,
}: {
  product: ProductDoc;
  text: string;
  muted: string;
  surface: string;
  surface2: string;
  border: string;
}) {
  const stock = Number(product.stockQty ?? 0);
  const hasDisc = (product.discountPercent ?? 0) > 0;
  const { finalPrice } = calcDiscount(product.price ?? 0, product.discountPercent ?? 0);
  const unit = hasDisc ? finalPrice : product.price ?? 0;

  return (
    <View style={[styles.rowCard, { backgroundColor: surface, borderColor: border }]}>
      {/* Left thumb */}
      <View style={[styles.rowThumb, { backgroundColor: surface2, borderColor: border }]}>
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <IconSymbol size={18} name="photo" color={muted} />
        )}

        {hasDisc ? (
          <View style={[styles.rowBadge, { backgroundColor: "rgba(245,158,11,0.18)", borderColor: "rgba(245,158,11,0.35)" }]}>
            <Text style={[styles.rowBadgeText, { color: "#FCD34D" }]}>-{round2(product.discountPercent)}%</Text>
          </View>
        ) : null}
      </View>

      {/* Middle */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>
          {product.name}
        </Text>

        <Text style={[styles.rowSub, { color: muted }]} numberOfLines={1}>
          {product.barcode ?? product.serialNumber ?? product.sku ?? "—"}
        </Text>

        <View style={styles.rowMetaLine}>
          {!product.active ? (
            <View style={[styles.metaPill, { backgroundColor: "rgba(239,68,68,0.15)", borderColor: "rgba(239,68,68,0.30)" }]}>
              <Text style={[styles.metaText, { color: "#FCA5A5" }]}>OFF</Text>
            </View>
          ) : null}

          {hasDisc ? (
            <View style={[styles.metaPill, { backgroundColor: "rgba(245,158,11,0.15)", borderColor: "rgba(245,158,11,0.30)" }]}>
              <Text style={[styles.metaText, { color: "#FCD34D" }]}>ZBRITJE</Text>
            </View>
          ) : (
            <View style={[styles.metaPill, { backgroundColor: "rgba(255,255,255,0.06)", borderColor: border }]}>
              <Text style={[styles.metaText, { color: muted }]}>NORMAL</Text>
            </View>
          )}
        </View>
      </View>

      {/* Right: price + stock */}
      <View style={styles.rowRight}>
        <View style={{ alignItems: "flex-end" }}>
          {hasDisc ? (
            <Text style={[styles.rowOldPrice, { color: muted }]}>€{Number(product.price ?? 0).toFixed(2)}</Text>
          ) : (
            <Text style={[styles.rowOldPrice, { color: "transparent" }]}>.</Text>
          )}
          <Text style={[styles.rowPrice, { color: text }]}>€{unit.toFixed(2)}</Text>
        </View>

        <View
          style={[
            styles.stockPill,
            {
              borderColor: border,
              backgroundColor: stock > 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            },
          ]}
        >
          <Text style={{ color: text, fontWeight: "900", fontSize: 12 }}>{stock}</Text>
        </View>
      </View>
    </View>
  );
}

function InfoLine({
  label,
  value,
  text,
  muted,
  strong,
}: {
  label: string;
  value: string;
  text: string;
  muted: string;
  strong?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ color: muted, fontWeight: "800", fontSize: 12 }}>{label}</Text>

      <Text style={{ color: text, fontWeight: strong ? "900" : "800", fontSize: 12 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function EmptyState({
  hasQuery,
  tint,
  muted,
  loading,
}: {
  hasQuery: boolean;
  tint: string;
  muted: string;
  loading: boolean;
}) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { borderColor: "rgba(255,255,255,0.10)" }]}>
        <IconSymbol size={28} name="magnifyingglass" color={tint} />
      </View>
      <Text style={[styles.emptyTitle, { color: "#E5E7EB" }]}>
        {loading ? "Duke u ngarku produktet..." : hasQuery ? "Nuk u gjet asgjë" : "Shkruaj barkod / nr. serik"}
      </Text>
      <Text style={[styles.emptySub, { color: muted }]}>
        {loading
          ? "Po i lexojmë nga databaza."
          : hasQuery
          ? "Kontrollo shifrat ose provo me emër/SKU."
          : "P.sh. shkruaj barkodin ose nr. serik."}
      </Text>
    </View>
  );
}

/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, paddingTop: 10 },

  header: { gap: 12, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { fontSize: 13, fontWeight: "600" },

  pillsRow: { flexDirection: "row", gap: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 44,
  },
  pillText: { fontSize: 13, fontWeight: "900" },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    borderWidth: 1,
  },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: "700", paddingVertical: 6 },
  iconBtn: { padding: 8, borderRadius: 999 },

  resultsHeader: {
    marginTop: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultsTitle: { fontSize: 16, fontWeight: "900" },
  countPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  resultsCount: { fontSize: 12, fontWeight: "900" },

  listContent: { paddingBottom: 20 },

  rowCard: {
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowThumb: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rowBadge: {
    position: "absolute",
    bottom: -6,
    left: -6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  rowBadgeText: { fontSize: 10, fontWeight: "900" },

  rowTitle: { fontSize: 15, fontWeight: "900" },
  rowSub: { fontSize: 12, fontWeight: "700", marginTop: 4 },

  rowMetaLine: { flexDirection: "row", gap: 8, marginTop: 8 },
  metaPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  metaText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.3 },

  rowRight: { alignItems: "flex-end", gap: 10 },
  rowOldPrice: { fontSize: 11, fontWeight: "800", textDecorationLine: "line-through" },
  rowPrice: { fontSize: 15, fontWeight: "900" },

  stockPill: {
    minWidth: 44,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22, gap: 10 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emptyTitle: { fontSize: 16, fontWeight: "900", marginTop: 6 },
  emptySub: { fontSize: 13, fontWeight: "700", textAlign: "center" },

  // POPUP
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.60)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  popupCard: {
    width: "100%",
    maxWidth: 860,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  popupTopBig: { flexDirection: "row", gap: 14, alignItems: "flex-start" },

  popupImageBig: {
    width: 190,
    height: 190,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  imgFallback: { flex: 1, alignItems: "center", justifyContent: "center" },

  badgesOnImage: {
    position: "absolute",
    left: 10,
    top: 10,
    flexDirection: "row",
    gap: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: "900" },

  popupTitle: { fontSize: 18, fontWeight: "900", lineHeight: 22 },

  priceBox: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  priceLabel: { fontSize: 12, fontWeight: "900" },
  priceFinal: { fontSize: 22, fontWeight: "900" },
  priceSmall: { fontSize: 12, fontWeight: "800" },
  priceOld: { fontSize: 12, fontWeight: "900", textDecorationLine: "line-through" },

  popupActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  sellBtn: { flex: 1, minHeight: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sellText: { fontSize: 15, fontWeight: "900" },

  cancelBtn: { flex: 1, minHeight: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontWeight: "900" },

  popupHint: { fontSize: 11, fontWeight: "700" },
});
