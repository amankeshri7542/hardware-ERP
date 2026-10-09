import React, { useState, useRef, useEffect } from 'react';
import { Input, Spin, Empty } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useProductSearch } from '../../hooks/useProductSearch';
import { formatINR } from '../../utils/formatCurrency';
import './ProductSearch.css';

/**
 * Reusable ProductSearch component — used in billing (Phase 3) and purchases.
 *
 * Props:
 *   onSelect(product)  — called when user picks a product
 *   billType           — 'retail' | 'wholesale' (controls price display)
 *   autoFocus          — focus input on mount
 *   placeholder        — input placeholder text
 */
export default function ProductSearch({
  onSelect,
  billType = 'retail',
  autoFocus = false,
  placeholder = 'Search products...',
}) {
  const { query, setQuery, results, isLoading } = useProductSearch({ billType });
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Open dropdown when there are results to show
  useEffect(() => {
    if (results.length > 0) {
      setIsOpen(true);
    }
  }, [results, query]);

  const handleSelect = (product) => {
    onSelect(product);
    setQuery('');
    setIsOpen(false);
    setHighlightIndex(-1);
    if (inputRef.current) inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    const items = results.length > 0 ? results : [];

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && items[highlightIndex]) {
          handleSelect(items[highlightIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="product-search-wrapper">
      <Input
        ref={inputRef}
        prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlightIndex(-1);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={(event) => {
          const input = event.target;
          setTimeout(() => { if (document.activeElement !== input) setIsOpen(false); }, 200);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        size="large"
      />

      {isOpen && (
        <div className="product-search-dropdown" ref={dropdownRef}>

          {/* Loading */}
          {isLoading && (
            <div className="product-search-loading">
              <Spin size="small" /> <span>Searching...</span>
            </div>
          )}

          {/* Results */}
          {!isLoading && results.length > 0 && (
            <ul className="product-search-results">
              {results.map((product, index) => (
                <li
                  key={product.id}
                  className={`product-search-item ${index === highlightIndex ? 'highlighted' : ''}`}
                  onMouseDown={() => handleSelect(product)}
                  onMouseEnter={() => setHighlightIndex(index)}
                >
                  <div className="item-main">
                    <span className="item-name">{product.name}</span>
                    <span className="item-unit">{product.unit}</span>
                  </div>
                  <div className="item-meta">
                    <span className={`item-stock ${product.stock_status === 'no_stock' ? 'no-stock' : 'in-stock'}`}>
                      {product.current_stock > 0 ? `${product.current_stock} units` : 'No Stock'}
                    </span>
                    <span className="item-price">
                      {formatINR(product.display_price || (billType === 'wholesale' ? product.wholesale_price : product.mrp))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Empty state */}
          {!isLoading && results.length === 0 && query.length >= 2 && (
            <div className="product-search-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No products found" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
