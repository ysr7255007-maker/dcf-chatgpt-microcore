// SDSL FM-index engine with calibrate mode for separated operations
// Modes: build | query | recover | calibrate
#include <sdsl/suffix_arrays.hpp>
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <chrono>
#include <filesystem>
#include <algorithm>
using namespace sdsl;
using namespace std;
namespace fs = std::filesystem;

typedef csa_wt<wt_hutu<rrr_vector<63>>, 64, 64> csa_t;

// Minimal JSON string extraction (no external JSON lib).
// Tolerant of standard JSON whitespace: '"key": "value"' and '"key":"value"'.
static string json_get_string(const string& line, const string& key) {
    string search = "\"" + key + "\":";
    auto pos = line.find(search);
    if (pos == string::npos) return "";
    pos += search.size();
    while (pos < line.size() && (line[pos] == ' ' || line[pos] == '\t')) pos++;
    if (pos >= line.size() || line[pos] != '"') return "";
    pos++;
    string result;
    while (pos < line.size() && line[pos] != '"') {
        if (line[pos] == '\\' && pos + 1 < line.size()) {
            pos++;
            if (line[pos] == '"') result += '"';
            else if (line[pos] == '\\') result += '\\';
            else if (line[pos] == 'n') result += '\n';
            else if (line[pos] == 't') result += '\t';
            else if (line[pos] == 'r') result += '\r';
            else if (line[pos] == 'u' && pos + 4 < line.size()) {
                string hex = line.substr(pos + 1, 4);
                unsigned int cp = (unsigned int)strtoul(hex.c_str(), nullptr, 16);
                if (cp < 0x80) result += (char)cp;
                else if (cp < 0x800) {
                    result += (char)(0xC0 | (cp >> 6));
                    result += (char)(0x80 | (cp & 0x3F));
                } else {
                    result += (char)(0xE0 | (cp >> 12));
                    result += (char)(0x80 | ((cp >> 6) & 0x3F));
                    result += (char)(0x80 | (cp & 0x3F));
                }
                pos += 4;
            } else {
                result += line[pos];
            }
        } else {
            result += line[pos];
        }
        pos++;
    }
    return result;
}


// Compact SHA-256 (FIPS 180-4), returns lowercase hex digest.
static inline uint32_t rotr32(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

static string sha256_hex(const string& data) {
    static const uint32_t K[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    };
    uint32_t h[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    size_t len = data.size();
    size_t padded = ((len + 8) / 64 + 1) * 64;
    vector<uint8_t> buf(padded, 0);
    memcpy(buf.data(), data.data(), len);
    buf[len] = 0x80;
    uint64_t bitlen = (uint64_t)len * 8;
    for (int i = 0; i < 8; i++) buf[padded - 1 - i] = (uint8_t)(bitlen >> (8 * i));
    for (size_t off = 0; off < padded; off += 64) {
        uint32_t w[64];
        for (int i = 0; i < 16; i++) {
            w[i] = ((uint32_t)buf[off + 4*i] << 24) | ((uint32_t)buf[off + 4*i+1] << 16)
                 | ((uint32_t)buf[off + 4*i+2] << 8) | (uint32_t)buf[off + 4*i+3];
        }
        for (int i = 16; i < 64; i++) {
            uint32_t s0 = rotr32(w[i-15],7) ^ rotr32(w[i-15],18) ^ (w[i-15] >> 3);
            uint32_t s1 = rotr32(w[i-2],17) ^ rotr32(w[i-2],19) ^ (w[i-2] >> 10);
            w[i] = w[i-16] + s0 + w[i-7] + s1;
        }
        uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
        for (int i = 0; i < 64; i++) {
            uint32_t S1 = rotr32(e,6) ^ rotr32(e,11) ^ rotr32(e,25);
            uint32_t ch = (e & f) ^ (~e & g);
            uint32_t t1 = hh + S1 + ch + K[i] + w[i];
            uint32_t S0 = rotr32(a,2) ^ rotr32(a,13) ^ rotr32(a,22);
            uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = S0 + maj;
            hh=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
        }
        h[0]+=a; h[1]+=b; h[2]+=c; h[3]+=d; h[4]+=e; h[5]+=f; h[6]+=g; h[7]+=hh;
    }
    static const char* hexd = "0123456789abcdef";
    string out;
    for (int i = 0; i < 8; i++) {
        for (int j = 0; j < 4; j++) {
            uint8_t byte = (uint8_t)(h[i] >> (24 - 8*j));
            out += hexd[byte >> 4];
            out += hexd[byte & 0xF];
        }
    }
    return out;
}

static size_t json_get_int(const string& line, const string& key, size_t def = 0) {
    string search = "\"" + key + "\":";
    auto pos = line.find(search);
    if (pos == string::npos) return def;
    pos += search.size();
    while (pos < line.size() && (line[pos] == ' ' || line[pos] == '\t')) pos++;
    return stoull(line.substr(pos));
}

int main(int argc, char* argv[]) {
    if (argc < 3) {
        cerr << "Usage: " << argv[0] << " <corpus.bin> <mode: build|open|query|recover|calibrate>" << endl;
        return 1;
    }
    string corpus_path = argv[1];
    string mode = argv[2];
    string idx_path = corpus_path + ".csa";

    if (mode == "build") {
        ifstream ifs(corpus_path, ios::binary);
        string data((istreambuf_iterator<char>(ifs)), istreambuf_iterator<char>());
        for (auto& c : data) { if (c == '\0') c = '\x01'; }

        auto t0 = chrono::high_resolution_clock::now();
        csa_t csa;
        construct_im(csa, data, 1);
        auto t1 = chrono::high_resolution_clock::now();
        double build_ms = chrono::duration<double, milli>(t1 - t0).count();

        store_to_file(csa, idx_path);
        uint64_t index_bytes = fs::file_size(idx_path);
        uint64_t input_bytes = fs::file_size(corpus_path);

        cout << "{\"build_time_ms\":" << build_ms
             << ",\"index_bytes\":" << index_bytes
             << ",\"input_bytes\":" << input_bytes
             << ",\"csa_size\":" << csa.size() << "}" << endl;
        return 0;
    }

    if (mode == "open") {
        auto t0 = chrono::high_resolution_clock::now();
        csa_t csa;
        load_from_file(csa, idx_path);
        auto t1 = chrono::high_resolution_clock::now();
        double open_ms = chrono::duration<double, milli>(t1 - t0).count();
        uint64_t index_bytes = fs::file_size(idx_path);
        cout << "{\"open_time_ms\":" << open_ms << ",\"index_bytes\":" << index_bytes
             << ",\"csa_size\":" << csa.size() << "}" << endl;
        return 0;
    }

    // Load index for query/recover/calibrate modes
    csa_t csa;
    load_from_file(csa, idx_path);

    if (mode == "query") {
        string line;
        while (getline(cin, line)) {
            if (line.empty()) continue;
            for (auto& c : line) { if (c == '\0') c = '\x01'; }
            auto t0 = chrono::high_resolution_clock::now();
            auto occ = locate(csa, line.begin(), line.end());
            auto t1 = chrono::high_resolution_clock::now();
            double us = chrono::duration<double, micro>(t1 - t0).count();
            // Escape the pattern so the response line stays valid JSON
            // (quotes in patterns must not break the output protocol).
            string esc;
            esc.reserve(line.size());
            for (char c : line) {
                if (c == '"') esc += "\\\"";
                else if (c == '\\') esc += "\\\\";
                else if (c == '\n') esc += "\\n";
                else if (c == '\r') esc += "\\r";
                else if (c == '\t') esc += "\\t";
                else esc += c;
            }
            cout << "{\"query\":\"" << esc << "\",\"count\":" << occ.size()
                 << ",\"time_us\":" << us << ",\"spans\":[";
            size_t lim = std::min<size_t>(occ.size(), 10);
            for (size_t i = 0; i < lim; i++) {
                if (i > 0) cout << ",";
                cout << "{\"start\":" << occ[i] << ",\"end\":" << (occ[i] + line.size()) << "}";
            }
            cout << "]}" << endl;
        }
        return 0;
    }

    if (mode == "recover") {
        auto t0 = chrono::high_resolution_clock::now();
        string recovered;
        recovered.resize(csa.size());
        for (size_t i = 0; i < csa.size(); i++) {
            auto ex = extract(csa, i, i);
            recovered[i] = ex[0];
        }
        auto t1 = chrono::high_resolution_clock::now();
        double ms = chrono::duration<double, milli>(t1 - t0).count();
        cout << "{\"recover_ms\":" << ms << ",\"recovered_bytes\":" << recovered.size() << "}" << endl;
        return 0;
    }

    if (mode == "calibrate") {
        // Read JSON-lines instructions from stdin
        string line;
        while (getline(cin, line)) {
            if (line.empty()) continue;
            string op = json_get_string(line, "op");

            if (op == "count") {
                string pat = json_get_string(line, "pattern");
                for (auto& c : pat) { if (c == '\0') c = '\x01'; }
                auto t0 = chrono::high_resolution_clock::now();
                size_t cnt = count(csa, pat.begin(), pat.end());
                auto t1 = chrono::high_resolution_clock::now();
                double us = chrono::duration<double, micro>(t1 - t0).count();
                cout << "{\"op\":\"count\",\"count\":" << cnt << ",\"time_us\":" << us << "}" << endl;
            }
            else if (op == "locate") {
                string pat = json_get_string(line, "pattern");
                size_t limit = json_get_int(line, "limit", 0);
                for (auto& c : pat) { if (c == '\0') c = '\x01'; }

                auto t0 = chrono::high_resolution_clock::now();
                // Get SA interval via backward_search
                csa_t::size_type sp = 0, ep = 0;
                csa_t::size_type cnt2 = backward_search(csa, (csa_t::size_type)0, csa.size()-1, pat.cbegin(), pat.cend(), sp, ep); bool found = cnt2 > 0;
                size_t total = found ? (ep - sp + 1) : 0;
                size_t actual_limit = (limit == 0) ? total : std::min<size_t>(limit, total);

                vector<size_t> positions;
                positions.reserve(actual_limit);
                for (size_t i = 0; i < actual_limit; i++) {
                    positions.push_back(csa[sp + i]);
                }
                auto t1 = chrono::high_resolution_clock::now();
                double us = chrono::duration<double, micro>(t1 - t0).count();

                cout << "{\"op\":\"locate\",\"requested\":" << limit
                     << ",\"total\":" << total
                     << ",\"returned\":" << positions.size()
                     << ",\"time_us\":" << us << ",\"spans\":[";
                for (size_t i = 0; i < positions.size(); i++) {
                    if (i > 0) cout << ",";
                    cout << "{\"start\":" << positions[i] << ",\"end\":" << (positions[i] + pat.size()) << "}";
                }
                cout << "]}" << endl;
            }
            else if (op == "extract") {
                size_t start = json_get_int(line, "start", 0);
                size_t end = json_get_int(line, "end", 0);
                if (end > csa.size()) end = csa.size();
                if (start >= end) {
                    cout << "{\"op\":\"extract\",\"bytes\":0,\"time_us\":0}" << endl;
                    continue;
                }
                auto t0 = chrono::high_resolution_clock::now();
                auto result = extract(csa, start, end - 1);
                auto t1 = chrono::high_resolution_clock::now();
                double us = chrono::duration<double, micro>(t1 - t0).count();
                cout << "{\"op\":\"extract\",\"bytes\":" << result.size() << ",\"time_us\":" << us << "}" << endl;
            }
            else if (op == "recover") {
                auto t0 = chrono::high_resolution_clock::now();
                string recovered;
                recovered.resize(csa.size());
                for (size_t i = 0; i < csa.size(); i++) {
                    auto ex = extract(csa, i, i);
                    recovered[i] = ex[0];
                }
                auto t1 = chrono::high_resolution_clock::now();
                double us = chrono::duration<double, micro>(t1 - t0).count();

                // SHA-256 verification against the source corpus.
                // Build canonicalizes NUL bytes to 0x01 (sdsl byte-CSA sentinel),
                // so apply the same transform before comparing.
                // The CSA includes one sentinel byte, so drop the trailing byte
                // when recovered is exactly corpus_size + 1.
                ifstream cfs(corpus_path, ios::binary);
                string corpus((istreambuf_iterator<char>(cfs)), istreambuf_iterator<char>());
                for (auto& c : corpus) { if (c == '\0') c = '\x01'; }
                string expected = sha256_hex(corpus);
                string check = recovered;
                bool match = false;
                if (recovered.size() == corpus.size()) {
                    match = (sha256_hex(recovered) == expected);
                } else if (recovered.size() == corpus.size() + 1) {
                    check = recovered.substr(0, corpus.size());
                    match = (sha256_hex(check) == expected);
                }
                cout << "{\"op\":\"recover\",\"bytes\":" << recovered.size()
                     << ",\"corpus_bytes\":" << corpus.size()
                     << ",\"time_us\":" << us
                     << ",\"recovered_sha256\":\"" << sha256_hex(check)
                     << "\",\"expected_sha256\":\"" << expected
                     << "\",\"sha256_match\":" << (match ? "true" : "false") << "}" << endl;
            }
            else {
                cerr << "Unknown op: " << op << endl;
            }
        }
        return 0;
    }

    cerr << "Unknown mode: " << mode << endl;
    return 1;
}
