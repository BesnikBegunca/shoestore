// app/(tabs)/products.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, storage } from "../../src/firebase";

/* ================= TYPES ================= */

type ProductDoc = {
  id: string;
  name: string;
  sku?: string;
  serialNumber?: string;
  barcode?: string;

  price: number; // shitje
  purchasePrice?: number; // ✅ blerje/kosto (s’po e shfaqim në tabelë)
  stockQty?: number; // ✅ stok

  discountPercent: number; // 0..100
  active: boolean;

  imageUrl?: string;
  imagePath?: string;
  createdAtMs?: number;
};

/* ================= HELPERS ================= */

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

const parseNumber = (txt: string) => {
  const n = Number(String(txt ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const parseIntSafe = (txt: string) => {
  const n = parseInt(String(txt ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const calcDiscount = (price: number, discountPercent: number) => {
  const p = Number.isFinite(price) ? price : 0;
  const d = clamp(Number.isFinite(discountPercent) ? discountPercent : 0, 0, 100);

  const discountAmount = round2((p * d) / 100);
  const finalPrice = round2(p - discountAmount);
  return { discountAmount, finalPrice };
};

const compressImage = async (uri: string) => {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  return result.uri;
};

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return await res.blob();
}

function makeStoragePath() {
  const ts = Date.now();
  const rand = Math.random().toString(16).slice(2);
  return `products/${ts}_${rand}.jpg`;
}

/* ================= COMPONENT ================= */

export default function Products() {
  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // modal state (create/edit)
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrevImagePath, setEditingPrevImagePath] = useState<string | null>(null);

  // delete confirm modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProductDoc | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // form fields
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [barcode, setBarcode] = useState("");

  const [priceText, setPriceText] = useState("");
  const [purchasePriceText, setPurchasePriceText] = useState(""); // ✅ NEW
  const [stockText, setStockText] = useState("0"); // ✅ NEW

  const [discountText, setDiscountText] = useState("0");
  const [active, setActive] = useState(true);

  // image (local)
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const price = useMemo(() => parseNumber(priceText), [priceText]);
  const purchasePrice = useMemo(() => parseNumber(purchasePriceText), [purchasePriceText]);
  const stockQty = useMemo(() => clamp(parseIntSafe(stockText), 0, 1_000_000), [stockText]);

  const discountPercent = useMemo(() => clamp(parseNumber(discountText), 0, 100), [discountText]);

  const { discountAmount, finalPrice } = useMemo(
    () => calcDiscount(price, discountPercent),
    [price, discountPercent]
  );

  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
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
            imagePath: data?.imagePath ? String(data.imagePath) : undefined,
            createdAtMs,
          };
        });

        setProducts(list);
        setLoading(false);
      },
      (err) => {
        console.log("SNAPSHOT ERROR:", err);
        Alert.alert("Gabim", "S’u lexuan produktet nga Firestore.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setEditingPrevImagePath(null);

    setName("");
    setSku("");
    setSerialNumber("");
    setBarcode("");

    setPriceText("");
    setPurchasePriceText("");
    setStockText("0");

    setDiscountText("0");
    setActive(true);

    setImageUri(null);
    setSaving(false);
  };

  const closeModal = () => {
    setModalVisible(false);
    resetForm();
  };

  const openCreate = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEdit = (p: ProductDoc) => {
    setEditingId(p.id);
    setEditingPrevImagePath(p.imagePath ?? null);

    setName(p.name ?? "");
    setSku(p.sku ?? "");
    setSerialNumber(p.serialNumber ?? "");
    setBarcode(p.barcode ?? "");

    setPriceText(String(p.price ?? ""));
    setPurchasePriceText(String(p.purchasePrice ?? "")); // ✅
    setStockText(String(p.stockQty ?? 0)); // ✅

    setDiscountText(String(p.discountPercent ?? 0));
    setActive(Boolean(p.active));

    setImageUri(null);
    setModalVisible(true);
  };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Leje e nevojshme", "Duhet me leju qasjen në galeri për me zgjedh foto.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1,
      });

      if (res.canceled) return;

      const originalUri = res.assets[0].uri;
      const compressedUri = await compressImage(originalUri);
      setImageUri(compressedUri);
    } catch (e) {
      console.log("PICK IMAGE ERROR:", e);
      Alert.alert("Gabim", "S’u zgjodh fotoja.");
    }
  };

  const uploadProductImageIfNeeded = async (): Promise<{ imageUrl?: string; imagePath?: string }> => {
    if (!imageUri) return {};
    const path = makeStoragePath();
    const storageRef = ref(storage, path);
    const blob = await uriToBlob(imageUri);
    await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(storageRef);
    return { imageUrl: url, imagePath: path };
  };

  const deleteStoragePathSafely = async (path?: string | null) => {
    if (!path) return;
    try {
      await deleteObject(ref(storage, path));
    } catch (e) {
      console.log("deleteObject failed:", e);
    }
  };

  const validateForm = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Kujdes", "Shkruje emrin e produktit.");
      return false;
    }
    if (!priceText.trim() || price <= 0) {
      Alert.alert("Kujdes", "Shkruje çmimin (duhet > 0).");
      return false;
    }
    // purchasePrice opsional, por nese e jep duhet me qenë >=0
    if (purchasePriceText.trim() && purchasePrice < 0) {
      Alert.alert("Kujdes", "Qmimi i blerjes s’mund me qenë negativ.");
      return false;
    }
    if (discountPercent < 0 || discountPercent > 100) {
      Alert.alert("Kujdes", "Zbritja duhet me qenë 0–100.");
      return false;
    }
    if (stockQty < 0) {
      Alert.alert("Kujdes", "Stoku s’mund me qenë negativ.");
      return false;
    }
    const b = barcode.trim();
    if (b && b.length < 6) {
      Alert.alert("Kujdes", "Barkodi duket shumë i shkurtë.");
      return false;
    }
    return true;
  };

  const saveProduct = async () => {
    if (saving) return;
    if (!validateForm()) return;

    setSaving(true);
    try {
      const trimmed = name.trim();
      const skuValue = sku.trim() ? sku.trim() : null;
      const serialValue = serialNumber.trim() ? serialNumber.trim() : null;
      const barcodeValue = barcode.trim() ? barcode.trim() : null;

      const purchaseValue =
        purchasePriceText.trim() === "" ? null : round2(purchasePrice);

      const uploaded = await uploadProductImageIfNeeded();

      if (!editingId) {
        await addDoc(collection(db, "products"), {
          name: trimmed,
          sku: skuValue,
          serialNumber: serialValue,
          barcode: barcodeValue,

          price: round2(price),
          purchasePrice: purchaseValue, // ✅
          stockQty: Number(stockQty), // ✅

          discountPercent: round2(discountPercent),
          active: Boolean(active),
          ...uploaded,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
        });

        Alert.alert("Sukses", "Produkti u shtua.");
        closeModal();
      } else {
        const patch: any = {
          name: trimmed,
          sku: skuValue,
          serialNumber: serialValue,
          barcode: barcodeValue,

          price: round2(price),
          purchasePrice: purchaseValue, // ✅
          stockQty: Number(stockQty), // ✅

          discountPercent: round2(discountPercent),
          active: Boolean(active),
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        };

        if (uploaded.imageUrl && uploaded.imagePath) {
          patch.imageUrl = uploaded.imageUrl;
          patch.imagePath = uploaded.imagePath;
        }

        await updateDoc(doc(db, "products", editingId), patch);

        if (uploaded.imagePath && editingPrevImagePath) {
          await deleteStoragePathSafely(editingPrevImagePath);
        }

        Alert.alert("Sukses", "Produkti u ndryshua.");
        closeModal();
      }
    } catch (e: any) {
      console.log("SAVE FAILED:", e);
      Alert.alert("Gabim", e?.message ?? (editingId ? "S’u ndryshua produkti." : "S’u shtua produkti."));
      setSaving(false);
    }
  };

  /* ================= DELETE ================= */

  const openDeleteConfirm = (p: ProductDoc) => {
    setPendingDelete(p);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setPendingDelete(null);
  };

  const doDelete = async () => {
    const p = pendingDelete;
    if (!p) return;
    if (deletingId) return;

    setDeletingId(p.id);
    try {
      await deleteDoc(doc(db, "products", p.id));
      await deleteStoragePathSafely(p.imagePath);
      closeDeleteConfirm();
      Alert.alert("OK", "Produkti u fshi.");
    } catch (e: any) {
      closeDeleteConfirm();
      Alert.alert("Gabim", e?.message ?? "S’u fshi produkti.");
    } finally {
      setDeletingId(null);
    }
  };

  const toggleActiveQuick = async (p: ProductDoc) => {
    try {
      await updateDoc(doc(db, "products", p.id), {
        active: !p.active,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      });
    } catch (e: any) {
      console.log("TOGGLE ACTIVE FAILED:", e);
      Alert.alert("Gabim", e?.message ?? "S’u ndryshua statusi Active.");
    }
  };

  /* ================= TABLE UI ================= */

  const renderHeader = () => (
    <View style={styles.tableHeader}>
      <Text style={[styles.hCell, styles.colName]}>Produkt</Text>
      <Text style={[styles.hCell, styles.colSku]}>SKU</Text>
      <Text style={[styles.hCell, styles.colSerial]}>Nr. Serik</Text>
      <Text style={[styles.hCell, styles.colBarcode]}>Barkod</Text>
      <Text style={[styles.hCell, styles.colStock]}>Stok</Text>
      <Text style={[styles.hCell, styles.colPrice]}>Final</Text>
      <Text style={[styles.hCell, styles.colStatus]}>Status</Text>
      <Text style={[styles.hCell, styles.colActions]}>Veprime</Text>
    </View>
  );

  const renderRow = ({ item, index }: { item: ProductDoc; index: number }) => {
    const { discountAmount: discAmt, finalPrice: fp } = calcDiscount(item.price, item.discountPercent);
    const hasDiscount = item.discountPercent > 0;
    const rowBg = index % 2 === 0 ? COLORS.surface : COLORS.surface2;
    const finalToShow = hasDiscount ? fp : item.price;

    return (
      <View style={[styles.rowWrap, { backgroundColor: rowBg }]} pointerEvents="box-none">
        <View style={[styles.cell, styles.colName]} pointerEvents="box-none">
          <View style={styles.prodCell} pointerEvents="box-none">
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>P</Text>
              </View>
            )}
            <View style={{ flex: 1 }} pointerEvents="none">
              <Text style={styles.prodName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.prodSub} numberOfLines={1}>
                {hasDiscount ? `-${discAmt.toFixed(2)}€ (${item.discountPercent.toFixed(0)}%)` : "—"}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.cellText, styles.cell, styles.colSku]} numberOfLines={1}>
          {item.sku ?? "—"}
        </Text>

        <Text style={[styles.cellText, styles.cell, styles.colSerial]} numberOfLines={1}>
          {item.serialNumber ?? "—"}
        </Text>

        <Text style={[styles.cellText, styles.cell, styles.colBarcode]} numberOfLines={1}>
          {item.barcode ?? "—"}
        </Text>

        <Text style={[styles.cellText, styles.cell, styles.colStock]} numberOfLines={1}>
          {Number(item.stockQty ?? 0)}
        </Text>

        <Text style={[styles.priceText, styles.cell, styles.colPrice]} numberOfLines={1}>
          {finalToShow.toFixed(2)}€
        </Text>

        <View style={[styles.cell, styles.colStatus, styles.stretchCell]} pointerEvents="none">
          <View style={[styles.statusPill, item.active ? styles.statusOn : styles.statusOff]}>
            <Text style={[styles.statusText, item.active ? styles.statusTextOn : styles.statusTextOff]}>
              {item.active ? "Active" : "Off"}
            </Text>
          </View>
        </View>

        <View style={[styles.cell, styles.colActions, styles.stretchCellActions]} pointerEvents="box-none">
          <View style={styles.actionsRow} pointerEvents="box-none">
            <Pressable
              onPress={() => openEdit(item)}
              hitSlop={14}
              style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.smallBtnText}>Edit</Text>
            </Pressable>

            <Pressable
              onPress={() => openDeleteConfirm(item)}
              hitSlop={18}
              style={({ pressed }) => [
                styles.smallBtnDanger,
                pressed && { opacity: 0.85 },
                deletingId === item.id ? { opacity: 0.6 } : null,
              ]}
              disabled={deletingId === item.id}
            >
              {deletingId === item.id ? <ActivityIndicator /> : <Text style={styles.smallBtnTextDanger}>Delete</Text>}
            </Pressable>
          </View>

          <View style={styles.activeSwitchRow} pointerEvents="box-none">
            <Text style={styles.activeSwitchLabel}>Active</Text>
            <Switch value={item.active} onValueChange={() => toggleActiveQuick(item)} />
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.headerPad}>
          <View style={styles.topBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.screenTitle}>Produktet</Text>
              <Text style={styles.headerSub}>{loading ? "Duke u ngarku..." : `${products.length} produkte`}</Text>
            </View>

            <Pressable onPress={openCreate} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.9 }]} hitSlop={12}>
              <Text style={styles.addBtnText}>+ Shto</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.tableWrap}>
          {renderHeader()}

          <FlatList
            data={products}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            style={{ width: "100%", alignSelf: "stretch" }}
            contentContainerStyle={[styles.listContent, { width: "100%" }]}
            ListEmptyComponent={!loading ? <Text style={styles.emptyText}>S’ka produkte ende.</Text> : null}
          />
        </View>

        {/* DELETE CONFIRM MODAL */}
        <Modal transparent visible={deleteConfirmOpen} animationType="fade" onRequestClose={closeDeleteConfirm}>
          <View style={styles.modalBackdrop}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>Fshij produktin?</Text>
              <Text style={styles.confirmText}>
                A je i sigurt me fshi{" "}
                <Text style={{ fontWeight: "900", color: COLORS.text }}>{pendingDelete?.name ?? "produktin"}</Text>?
              </Text>

              <View style={styles.confirmActions}>
                <Pressable onPress={closeDeleteConfirm} style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}>
                  <Text style={styles.secondaryText}>Anulo</Text>
                </Pressable>

                <Pressable
                  onPress={doDelete}
                  disabled={!!deletingId}
                  style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.9 }, deletingId ? { opacity: 0.6 } : null]}
                >
                  {deletingId ? <ActivityIndicator /> : <Text style={styles.deleteBtnText}>Po, fshije</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* CREATE / EDIT MODAL */}
        <Modal
          transparent
          visible={modalVisible}
          animationType="fade"
          onRequestClose={() => {
            if (!saving) closeModal();
          }}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingId ? "Ndrysho produkt" : "Shto produkt"}</Text>
                <Pressable onPress={() => !saving && closeModal()} hitSlop={12}>
                  <Text style={styles.modalClose}>✕</Text>
                </Pressable>
              </View>

              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Emri (p.sh. Nike Air Max)"
                style={styles.input}
                placeholderTextColor={COLORS.muted}
              />

              <View style={styles.row2}>
                <TextInput
                  value={sku}
                  onChangeText={setSku}
                  placeholder="SKU (opsionale)"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                />
                <View style={styles.activeRow}>
                  <Text style={styles.activeLabel}>Active</Text>
                  <Switch value={active} onValueChange={setActive} />
                </View>
              </View>

              <View style={styles.row2}>
                <TextInput
                  value={serialNumber}
                  onChangeText={setSerialNumber}
                  placeholder="Nr. Serik (opsionale)"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                  autoCapitalize="characters"
                />
                <TextInput
                  value={barcode}
                  onChangeText={setBarcode}
                  placeholder="Barkod (opsionale)"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                  keyboardType="numeric"
                />
              </View>

              {/* ✅ NEW: price + purchasePrice */}
              <View style={styles.row2}>
                <TextInput
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder="Çmimi i shitjes €"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                />
                <TextInput
                  value={purchasePriceText}
                  onChangeText={setPurchasePriceText}
                  placeholder="Çmimi i blerjes € (ops.)"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                />
              </View>

              {/* ✅ NEW: stock + discount */}
              <View style={styles.row2}>
                <TextInput
                  value={stockText}
                  onChangeText={setStockText}
                  placeholder="Stoku (copa)"
                  keyboardType="numeric"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                />
                <TextInput
                  value={discountText}
                  onChangeText={setDiscountText}
                  placeholder="Zbritja %"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  placeholderTextColor={COLORS.muted}
                />
              </View>

              <View style={styles.preview}>
                <Text style={styles.previewText}>
                  {discountPercent.toFixed(0)}% → bie {discountAmount.toFixed(2)} € → final {finalPrice.toFixed(2)} €
                </Text>
              </View>

              <View style={styles.imageRow}>
                <Pressable onPress={pickImage} style={({ pressed }) => [styles.imageBtn, pressed && { opacity: 0.9 }]} hitSlop={10}>
                  <Text style={styles.imageBtnText}>{imageUri ? "Ndrysho foton" : "Shto foto"}</Text>
                </Pressable>

                <View style={styles.imagePreviewWrap}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.imagePreview} />
                  ) : (
                    <View style={styles.imagePreviewEmpty}>
                      <Text style={styles.imagePreviewEmptyText}>pa foto</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.modalActions}>
                <Pressable onPress={saveProduct} disabled={saving} style={[styles.primaryBtn, saving ? styles.primaryBtnDisabled : null]}>
                  {saving ? <ActivityIndicator /> : <Text style={styles.primaryText}>{editingId ? "Ruaj" : "Shto"}</Text>}
                </Pressable>

                <Pressable onPress={() => !saving && closeModal()} disabled={saving} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryText}>Anulo</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ================= THEME ================= */

const COLORS = {
  bg: "#0B0D14",
  surface: "#121627",
  surface2: "#0F1220",
  border: "#1E2440",
  text: "#E7E9F5",
  muted: "#98A2B3",
  brand: "#6D5EF6",
  success: "#22C55E",
  danger: "#EF4444",
  dangerBg: "#2A1216",
};

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg, width: "100%" },
  screen: { flex: 1, width: "100%", alignSelf: "stretch" },

  headerPad: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },

  topBar: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  screenTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  headerSub: { color: COLORS.muted, marginTop: 2, fontWeight: "700" },

  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: COLORS.brand,
    minHeight: 44,
    justifyContent: "center",
  },
  addBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },

  tableWrap: {
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },

  tableHeader: {
    width: "100%",
    alignSelf: "stretch",
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#0E1324",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  hCell: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },

  colName: { flex: 2.2 },
  colSku: { flex: 1.2 },
  colSerial: { flex: 1.4 },
  colBarcode: { flex: 1.4 },
  colStock: { flex: 0.7, textAlign: "right" },
  colPrice: { flex: 0.9, textAlign: "right" },
  colStatus: { flex: 0.9 },
  colActions: { flex: 1.9 },

  listContent: { paddingBottom: 18 },

  rowWrap: {
    width: "100%",
    alignSelf: "stretch",
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },

  cell: { justifyContent: "center", paddingRight: 8 },
  cellText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  priceText: { color: COLORS.text, fontSize: 12, fontWeight: "900", textAlign: "right" },

  stretchCell: { alignItems: "stretch" },
  stretchCellActions: { alignItems: "stretch", paddingRight: 0 },

  prodCell: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.surface2 },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { color: COLORS.muted, fontWeight: "900" },
  prodName: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  prodSub: { color: COLORS.muted, fontSize: 11, fontWeight: "800", marginTop: 2 },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "stretch",
    alignItems: "center",
  },
  statusOn: { backgroundColor: "#10251A", borderColor: "#174D2C" },
  statusOff: { backgroundColor: "#1B1F2E", borderColor: COLORS.border },
  statusText: { fontSize: 11, fontWeight: "900", textAlign: "center" },
  statusTextOn: { color: COLORS.success },
  statusTextOff: { color: COLORS.muted },

  actionsRow: { flexDirection: "row", gap: 8, alignItems: "center", width: "100%" },

  smallBtn: {
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

  smallBtnDanger: {
    minHeight: 36,
    minWidth: 80,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3A1A1D",
    backgroundColor: COLORS.dangerBg,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnTextDanger: { color: COLORS.danger, fontWeight: "900", fontSize: 12 },

  activeSwitchRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  activeSwitchLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "900" },

  emptyText: { color: COLORS.muted, padding: 18, textAlign: "center", fontWeight: "800" },

  /* MODALS */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.60)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },

  confirmCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 10,
  },
  confirmTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
  confirmText: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },
  confirmActions: { flexDirection: "row", gap: 10, marginTop: 6 },

  deleteBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: { color: "#0B0D14", fontWeight: "900" },

  modalCard: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
  modalClose: { color: COLORS.muted, fontSize: 18, fontWeight: "900" },

  input: {
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ ios: 10, android: 9, default: 9 }),
    borderRadius: 12,
    fontSize: 13,
    fontWeight: "700",
  },

  row2: { flexDirection: "row", gap: 10, alignItems: "center" },
  halfInput: { flex: 1 },

  activeRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface2,
  },
  activeLabel: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

  preview: {
    backgroundColor: "#0A0C14",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  previewText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },

  imageRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  imageBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brand,
  },
  imageBtnText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  imagePreviewWrap: { width: 64, height: 64 },
  imagePreview: { width: 64, height: 64, borderRadius: 12, backgroundColor: COLORS.surface2 },
  imagePreviewEmpty: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreviewEmptyText: { color: COLORS.muted, fontSize: 11, fontWeight: "900" },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 2 },
  primaryBtn: {
    flex: 1,
    backgroundColor: COLORS.success,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryText: { color: "#07110A", fontWeight: "900", fontSize: 13 },

  secondaryBtn: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryText: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
});
