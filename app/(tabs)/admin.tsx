import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import {
    addDoc,
    collection,
    query as fsQuery,
    onSnapshot,
    orderBy,
    serverTimestamp,
} from "firebase/firestore";
import { db } from "../../src/firebase";

/** -------- Helpers -------- */
const pad2 = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

const round2 = (n: number) => Math.round(n * 100) / 100;

function formatMonthLabel(mk: string) {
  const [y, m] = mk.split("-");
  const mm = Number(m);
  const monthNames = [
    "Janar","Shkurt","Mars","Prill","Maj","Qershor",
    "Korrik","Gusht","Shtator","Tetor","Nëntor","Dhjetor"
  ];
  return `${monthNames[Math.max(0, mm - 1)]} ${y}`;
}

function formatEuro(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `€${v.toFixed(2)}`;
}

function toLocalDateTime(ms?: number) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

/** -------- Types -------- */
type SaleDoc = {
  id: string;
  total: number;
  profitTotal: number;
  monthKey?: string;
  dayKey?: string;
  createdAtMs?: number;
};

type InvestmentDoc = {
  id: string;
  amount: number;
  note?: string;
  monthKey?: string;
  dayKey?: string;
  createdAtMs?: number;
};

type ProductDoc = {
  id: string;
  stockQty?: number;

  price?: number;            // base price
  finalPrice?: number;       // if you store final already
  discountPercent?: number;  // if discount is percent
  discount?: number;         // if you store discount in percent as "discount"
};


type ActivityItem =
  | {
      id: string;
      type: "SALE";
      createdAtMs?: number;
      title: string;
      sub?: string;
      amount: number; // total sale
    }
  | {
      id: string;
      type: "INVEST";
      createdAtMs?: number;
      title: string;
      sub?: string;
      amount: number; // invest amount
    };

export default function Admin() {
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? "light"];

  // dark vibe
  const bg = "#0B0F14";
  const surface = "#111827";
  const surface2 = "#0F172A";
  const stroke = "rgba(255,255,255,0.10)";
  const text = "#E5E7EB";
  const muted = "rgba(229,231,235,0.70)";
  const subtle = "rgba(229,231,235,0.50)";
  const tint = theme.tint;

  // colors for logs
  const green = "#22C55E";
  const red = "#EF4444";

  const [sales, setSales] = useState<SaleDoc[]>([]);
  const [investments, setInvestments] = useState<InvestmentDoc[]>([]);
  const [totalStock, setTotalStock] = useState<number>(0);
  const [totalStockValueFinal, setTotalStockValueFinal] = useState<number>(0);


  const [loading, setLoading] = useState(true);

  // month dropdown
  const [monthModalOpen, setMonthModalOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(monthKey(new Date()));

  // investment input
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  /** -------- Firestore listeners -------- */
  useEffect(() => {
    // SALES
    const qSales = fsQuery(collection(db, "sales"), orderBy("createdAt", "desc"));
    const unsubSales = onSnapshot(
      qSales,
      (snap) => {
        const list: SaleDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const createdAtMs =
            data?.createdAt?.toMillis?.() ??
            (typeof data?.createdAtMs === "number" ? data.createdAtMs : undefined);

          return {
            id: d.id,
            total: Number(data?.total ?? 0),
            profitTotal: Number(data?.profitTotal ?? 0),
            monthKey: typeof data?.monthKey === "string" ? data.monthKey : undefined,
            dayKey: typeof data?.dayKey === "string" ? data.dayKey : undefined,
            createdAtMs,
          };
        });
        setSales(list);
        setLoading(false);
      },
      (err) => {
        console.log(err);
        setLoading(false);
        Alert.alert("Gabim", "S’u lexuan sales nga Firestore.");
      }
    );

    // INVESTMENTS
    const qInv = fsQuery(collection(db, "owner_investments"), orderBy("createdAt", "desc"));
    const unsubInv = onSnapshot(
      qInv,
      (snap) => {
        const list: InvestmentDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const createdAtMs =
            data?.createdAt?.toMillis?.() ??
            (typeof data?.createdAtMs === "number" ? data.createdAtMs : undefined);

          return {
            id: d.id,
            amount: Number(data?.amount ?? 0),
            note: typeof data?.note === "string" ? data.note : undefined,
            monthKey: typeof data?.monthKey === "string" ? data.monthKey : undefined,
            dayKey: typeof data?.dayKey === "string" ? data.dayKey : undefined,
            createdAtMs,
          };
        });
        setInvestments(list);
      },
      (err) => console.log("INV LISTENER ERR:", err)
    );

    // PRODUCTS (TOTAL STOCK)
   // PRODUCTS (TOTAL STOCK + TOTAL STOCK VALUE FINAL)
const qProd = fsQuery(collection(db, "products"), orderBy("createdAt", "desc"));
const unsubProd = onSnapshot(
  qProd,
  (snap) => {
    const list: ProductDoc[] = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        stockQty: typeof data?.stockQty === "number" ? Number(data.stockQty) : 0,

        // read possible price fields
        price: typeof data?.price === "number" ? Number(data.price) : 0,
        finalPrice: typeof data?.finalPrice === "number" ? Number(data.finalPrice) : undefined,
        discountPercent:
          typeof data?.discountPercent === "number" ? Number(data.discountPercent) : undefined,
        discount: typeof data?.discount === "number" ? Number(data.discount) : undefined,
      };
    });

    // total pieces
    const sumQty = list.reduce((acc, p) => acc + Number(p.stockQty ?? 0), 0);
    setTotalStock(sumQty);

    // total value if everything sold at FINAL price
    const sumFinalValue = list.reduce((acc, p) => {
      const qty = Number(p.stockQty ?? 0);

      // decide discount percent field
      const disc = p.discountPercent ?? p.discount; // whichever exists

      // compute final price
      const fp =
        typeof disc === "number" && disc > 0
          ? Number(p.price ?? 0) * (1 - disc / 100)
          : Number(p.finalPrice ?? p.price ?? 0);

      return acc + fp * qty;
    }, 0);

    setTotalStockValueFinal(round2(sumFinalValue));
  },
  (err) => console.log("PRODUCTS LISTENER ERR:", err)
);


    return () => {
      unsubSales();
      unsubInv();
      unsubProd();
    };
  }, []);

  /** -------- Month options -------- */
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    set.add(monthKey(new Date()));
    for (const s of sales) if (s.monthKey) set.add(s.monthKey);
    for (const i of investments) if (i.monthKey) set.add(i.monthKey);

    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [sales, investments]);

  useEffect(() => {
    if (!monthOptions.includes(selectedMonth) && monthOptions.length > 0) {
      setSelectedMonth(monthOptions[0]);
    }
  }, [monthOptions, selectedMonth]);

  /** -------- Aggregations -------- */
  const stats = useMemo(() => {
    const totalSalesAll = sales.reduce((sum, s) => sum + Number(s.total ?? 0), 0);
    const totalProfitAll = sales.reduce((sum, s) => sum + Number(s.profitTotal ?? 0), 0);
    const countSalesAll = sales.length;

    const salesInMonth = sales.filter((s) => (s.monthKey ?? "") === selectedMonth);
    const totalSalesMonth = salesInMonth.reduce((sum, s) => sum + Number(s.total ?? 0), 0);
    const totalProfitMonth = salesInMonth.reduce((sum, s) => sum + Number(s.profitTotal ?? 0), 0);
    const countSalesMonth = salesInMonth.length;

    const totalInvestAll = investments.reduce((sum, i) => sum + Number(i.amount ?? 0), 0);
    const investInMonth = investments.filter((i) => (i.monthKey ?? "") === selectedMonth);
    const totalInvestMonth = investInMonth.reduce((sum, i) => sum + Number(i.amount ?? 0), 0);

    return {
      totalSalesAll: round2(totalSalesAll),
      totalSalesMonth: round2(totalSalesMonth),
      totalProfitAll: round2(totalProfitAll),
      totalProfitMonth: round2(totalProfitMonth),
      countSalesAll,
      countSalesMonth,
      totalInvestAll: round2(totalInvestAll),
      totalInvestMonth: round2(totalInvestMonth),
      totalStock: Number(totalStock ?? 0),
      totalStockValueFinal: round2(totalStockValueFinal),

    };
  }, [sales, investments, selectedMonth, totalStock, totalStockValueFinal]);

  /** -------- Activity log (Sales green + Invest red) -------- */
  const activity = useMemo<ActivityItem[]>(() => {
    const saleItems: ActivityItem[] = sales.slice(0, 25).map((s) => ({
      id: `sale_${s.id}`,
      type: "SALE",
      createdAtMs: s.createdAtMs,
      title: "SHITJE",
      sub: `Total: ${formatEuro(s.total)} • Fitim: ${formatEuro(s.profitTotal)}`,
      amount: Number(s.total ?? 0),
    }));

    const invItems: ActivityItem[] = investments.slice(0, 25).map((i) => ({
      id: `inv_${i.id}`,
      type: "INVEST",
      createdAtMs: i.createdAtMs,
      title: "BLEJ MALL",
      sub: i.note ? i.note : "—",
      amount: Number(i.amount ?? 0),
    }));

    const merged = [...saleItems, ...invItems].sort((a, b) => {
      const am = Number(a.createdAtMs ?? 0);
      const bm = Number(b.createdAtMs ?? 0);
      return bm - am;
    });

    return merged.slice(0, 20); // latest 20
  }, [sales, investments]);

  /** -------- Actions -------- */
  const addInvestment = async () => {
    const raw = amountText.trim().replace(",", ".");
    const amount = Number(raw);

    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Gabim", "Shkruaj një amount valid (p.sh. 1200 ose 1200.50).");
      return;
    }
    if (saving) return;

    setSaving(true);
    try {
      const now = new Date();
      await addDoc(collection(db, "owner_investments"), {
        amount: round2(amount),
        note: note?.trim() ? note.trim() : null,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
        dayKey: dayKey(now),
        monthKey: monthKey(now),
      });

      setAmountText("");
      setNote("");
    } catch (e) {
      console.log("ADD INVEST ERR:", e);
      Alert.alert("Gabim", "S’u regjistru investimi.");
    } finally {
      setSaving(false);
    }
  };

  /** -------- UI -------- */
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: text }]}>Admin Panel</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {loading ? "Duke u ngarku..." : "Analitika + Stok + Log (Investime & Shitje)."}
            </Text>
          </View>

          {/* Month dropdown */}
          <Pressable
            onPress={() => setMonthModalOpen(true)}
            style={({ pressed }) => [
              styles.monthBtn,
              { backgroundColor: surface, borderColor: stroke, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <IconSymbol size={18} name="calendar" color={tint} />
            <Text style={[styles.monthBtnText, { color: text }]} numberOfLines={1}>
              {formatMonthLabel(selectedMonth)}
            </Text>
            <IconSymbol size={16} name="chevron.down" color={subtle} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
          {/* Cards grid */}
          <View style={styles.grid}>
            {/* NEW: Total Stock */}
            <StatCard
              title="Stok Total (Copë)"
              value={`${stats.totalStock}`}
              icon="shippingbox.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />

            <StatCard
              title="Shitje (Total)"
              value={formatEuro(stats.totalSalesAll)}
              icon="eurosign.circle.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />
            <StatCard
              title={`Shitje (${formatMonthLabel(selectedMonth)})`}
              value={formatEuro(stats.totalSalesMonth)}
              icon="calendar.circle.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />

            <StatCard
              title="Fitim (Total)"
              value={formatEuro(stats.totalProfitAll)}
              icon="chart.line.uptrend.xyaxis.circle.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />
            <StatCard
              title={`Fitim (${formatMonthLabel(selectedMonth)})`}
              value={formatEuro(stats.totalProfitMonth)}
              icon="chart.bar.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />

            <StatCard
              title="Nr. shitjesh (Total)"
              value={`${stats.countSalesAll}`}
              icon="number.circle.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />
            <StatCard
              title={`Nr. shitjesh (${formatMonthLabel(selectedMonth)})`}
              value={`${stats.countSalesMonth}`}
              icon="list.number"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />

            <StatCard
              title="Investim (Total)"
              value={formatEuro(stats.totalInvestAll)}
              icon="tray.full.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />
            <StatCard
              title={`Investim (${formatMonthLabel(selectedMonth)})`}
              value={formatEuro(stats.totalInvestMonth)}
              icon="tray.and.arrow.down.fill"
              surface={surface}
              border={stroke}
              text={text}
              muted={muted}
            />
            <StatCard
  title="Vlera e Stokut (Final)"
  value={formatEuro(stats.totalStockValueFinal)}
  icon="eurosign.circle.fill"
  surface={"rgba(34,197,94,0.12)"}     // ✅ green background
  border={"rgba(34,197,94,0.35)"}      // ✅ green border
  text={"#86EFAC"}                     // ✅ green text
  muted={"rgba(134,239,172,0.75)"}     // ✅ green muted
/>

          </View>

          {/* Investment input */}
          <View style={[styles.sectionCard, { backgroundColor: surface, borderColor: stroke }]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <IconSymbol size={20} name="plus.circle.fill" color={tint} />
                <Text style={[styles.sectionTitle, { color: text }]}>Blej Mall (Investim)</Text>
              </View>
              <Text style={[styles.sectionHint, { color: subtle }]}>ruhet me datë + orë</Text>
            </View>

            <View style={styles.formRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: muted }]}>Amount (€)</Text>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  placeholder="p.sh. 1200.50"
                  placeholderTextColor={subtle}
                  keyboardType={Platform.select({ ios: "decimal-pad", android: "numeric", default: "numeric" })}
                  style={[styles.input, { color: text, borderColor: stroke, backgroundColor: "#0B1220" }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: muted }]}>Shënim (opsional)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="p.sh. Ble mall - furnitor X"
                  placeholderTextColor={subtle}
                  style={[styles.input, { color: text, borderColor: stroke, backgroundColor: "#0B1220" }]}
                />
              </View>
            </View>

            <Pressable
              onPress={addInvestment}
              disabled={saving}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: tint, opacity: pressed ? 0.92 : 1 },
                saving ? { opacity: 0.6 } : null,
              ]}
            >
              <Text style={[styles.primaryBtnText, { color: "#0B0F14" }]}>
                {saving ? "Duke ruajtur..." : "RUJE (BLEJ MALL)"}
              </Text>
            </Pressable>
          </View>

          {/* Activity log */}
          <View style={styles.sectionSpacer} />

          <View style={styles.listHeader}>
            <Text style={[styles.listTitle, { color: text }]}>Regjistrimet e fundit</Text>
            <Text style={[styles.listSub, { color: subtle }]}>(shitje = gjelbër, blej mall = kuqe)</Text>
          </View>

          <FlatList
            data={activity}
            keyExtractor={(i) => i.id}
            scrollEnabled={false}
            contentContainerStyle={{ gap: 10, paddingBottom: 6 }}
            renderItem={({ item }) => {
              const isSale = item.type === "SALE";
              const leftColor = isSale ? green : red;
              const bgRow = isSale ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)";
              const borderRow = isSale ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)";
              const iconName = isSale ? "checkmark.seal.fill" : "cart.fill";

              return (
                <View style={[styles.row, { backgroundColor: surface, borderColor: stroke }]}>
                  <View style={[styles.sideBar, { backgroundColor: bgRow, borderColor: borderRow }]}>
                    <IconSymbol size={18} name={iconName} color={leftColor} />
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                      <Text style={[styles.rowTop, { color: text }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[styles.amount, { color: leftColor }]} numberOfLines={1}>
                        {isSale ? `+${formatEuro(item.amount)}` : `-${formatEuro(item.amount)}`}
                      </Text>
                    </View>

                    <Text style={[styles.rowMid, { color: muted }]} numberOfLines={1}>
                      {item.sub ?? "—"}
                    </Text>

                    <Text style={[styles.rowBot, { color: subtle }]}>
                      {toLocalDateTime(item.createdAtMs)}
                    </Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={[styles.emptyBox, { borderColor: stroke }]}>
                <Text style={{ color: muted, fontWeight: "800" }}>S’ka regjistrime ende.</Text>
              </View>
            }
          />
        </ScrollView>

        {/* Month Modal */}
        <Modal transparent visible={monthModalOpen} animationType="fade" onRequestClose={() => setMonthModalOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: surface, borderColor: stroke }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: text }]}>Zgjedh muajin</Text>
                <Pressable onPress={() => setMonthModalOpen(false)} hitSlop={12}>
                  <IconSymbol size={20} name="xmark.circle.fill" color={tint} />
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: 10 }}>
                {monthOptions.map((mk) => {
                  const activeOpt = mk === selectedMonth;
                  return (
                    <Pressable
                      key={mk}
                      onPress={() => {
                        setSelectedMonth(mk);
                        setMonthModalOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.monthRow,
                        {
                          backgroundColor: activeOpt ? "rgba(255,255,255,0.06)" : "transparent",
                          borderColor: stroke,
                          opacity: pressed ? 0.92 : 1,
                        },
                      ]}
                    >
                      <IconSymbol
                        size={18}
                        name={activeOpt ? "checkmark.circle.fill" : "circle"}
                        color={activeOpt ? tint : subtle}
                      />
                      <Text style={[styles.monthRowText, { color: text }]}>{formatMonthLabel(mk)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

/** -------- Components -------- */
function StatCard({
  title,
  value,
  icon,
  surface,
  border,
  text,
  muted,
}: {
  title: string;
  value: string;
  icon: any;
  surface: string;
  border: string;
  text: string;
  muted: string;
}) {
  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
      <View style={styles.cardTop}>
        <IconSymbol size={20} name={icon} color={"rgba(229,231,235,0.85)"} />
        <Text style={[styles.cardTitle, { color: muted }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={[styles.cardValue, { color: text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** -------- Styles -------- */
const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, paddingTop: 10 },

  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: "950" as any },
  subtitle: { fontSize: 13, fontWeight: "700", marginTop: 6 },

  monthBtn: {
    minWidth: 170,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "space-between",
  },
  monthBtnText: { fontSize: 12, fontWeight: "900", flex: 1 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    width: "48.5%",
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 12, fontWeight: "900" },
  cardValue: { fontSize: 18, fontWeight: "950" as any },

  sectionSpacer: { height: 14 },

  sectionCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: "950" as any },
  sectionHint: { fontSize: 11, fontWeight: "800" },

  formRow: { flexDirection: "row", gap: 10 },
  label: { fontSize: 12, fontWeight: "900", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 14,
    fontWeight: "800",
  },

  primaryBtn: { minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  primaryBtnText: { fontSize: 13, fontWeight: "950" as any },

  listHeader: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  listTitle: { fontSize: 14, fontWeight: "950" as any },
  listSub: { fontSize: 11, fontWeight: "800" },

  row: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sideBar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTop: { fontSize: 14, fontWeight: "950" as any },
  amount: { fontSize: 13, fontWeight: "950" as any },
  rowMid: { fontSize: 12, fontWeight: "800", marginTop: 4 },
  rowBot: { fontSize: 11, fontWeight: "800", marginTop: 6 },

  emptyBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  // Month modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.60)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: 14, fontWeight: "950" as any },

  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  monthRowText: { fontSize: 13, fontWeight: "900" },
});
